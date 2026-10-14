"use client";
import { useEffect, useRef, useState } from "react";
import { brl } from "@/lib/pricing";
import { effectiveStatus } from "@/lib/status";
import PriceBreakdown from "../PriceBreakdown";
import { api, ApiError, fmtDT, fromLocalInput, toLocalInput } from "@/lib/client";

export type Mode = { id?: string; kind?: "manual" | "bloqueio" };
const STATUSES = ["pendente", "confirmada", "em_andamento", "finalizada", "cancelada", "irregular", "bloqueada"];
const inp = "mt-1 w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2";
const blank = { startAt: "", endAt: "", status: "confirmada", name: "", apartment: "", carBrand: "", carModel: "", carColor: "", plate: "", notes: "", total: "" };

function describe(e: any) {
  const d = e.details ?? {};
  if (e.action === "criada") return "Reserva criada pelo vizinho";
  if (e.action === "bloqueio_criado") return "Horário bloqueado pelo administrador";
  if (e.action === "foto_removida") return "Foto removida pelo administrador";
  if (e.action === "criada_manualmente") return "Registro criado manualmente pelo administrador";
  if (e.action === "status_alterado") return `${d.from === "bloqueada" ? "Bloqueio removido" : d.to === "confirmada" ? "Confirmada" : d.to === "cancelada" ? "Cancelada" : d.to === "irregular" ? "Marcada como irregular" : `Status: ${d.to}`}${d.from ? ` (antes: ${d.from})` : ""}${Object.keys(d.changes ?? {}).length ? " • " + Object.entries<any>(d.changes).map(([k, v]) => `${k}: ${v.from ?? "—"} → ${v.to ?? "—"}`).join(" • ") : ""}`;
  if (e.action === "foto_adicionada") return "Foto adicionada pelo administrador";
  if (e.action === "excluida") return "Excluída pelo administrador";
  if (e.action === "editada") return Object.entries<any>(d.changes ?? {}).map(([k, v]) => `${k}: ${v.from ?? "—"} → ${v.to ?? "—"}`).join(" • ") + (d.preco ? ` (valor ${d.preco})` : "");
  return e.action;
}

// Reduz a foto no navegador (máx. 1280px, JPEG) antes de enviar: rápido no celular e cabe no plano gratuito.
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = bmp.width * k; c.height = bmp.height * k;
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("Imagem inválida."))), "image/jpeg", 0.8));
}

export default function Editor({ mode, onClose, onSaved, onOpen }: { mode: Mode; onClose: () => void; onSaved: () => void; onOpen: (id: string) => void }) {
  const [f, setF] = useState({ ...blank, status: mode.kind === "bloqueio" ? "bloqueada" : "confirmada" });
  const [detail, setDetail] = useState<any>(null);
  const [priceMode, setPriceMode] = useState<"keep" | "recalc">("keep"); const [newQuote, setNewQuote] = useState<number | null>(null);
  const [err, setErr] = useState(""); const [conflicts, setConflicts] = useState<{ id: string; label: string }[]>([]); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });

  const load = async () => {
    if (!mode.id) return;
    const d = await api(`/api/admin/reservations/${mode.id}`); setDetail(d);
    setF({ startAt: toLocalInput(d.start_at), endAt: toLocalInput(d.end_at), status: d.status, name: d.name ?? "", apartment: d.apartment ?? "", carBrand: d.car_brand ?? "", carModel: d.car_model ?? "", carColor: d.car_color ?? "", plate: d.plate ?? "", notes: d.notes ?? "", total: (d.total_cents / 100).toFixed(2) });
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []); // eslint-disable-line

  const timesChanged = !!detail && !!f.startAt && !!f.endAt && (f.startAt !== toLocalInput(detail.start_at) || f.endAt !== toLocalInput(detail.end_at));
  const valueEdited = !!detail && f.total !== "" && Math.round(Number(f.total) * 100) !== detail.total_cents;
  useEffect(() => { // cotação com os preços ATUAIS, só para informar; nada é gravado
    setNewQuote(null);
    if (!timesChanged || f.status === "bloqueada") return;
    const t = setTimeout(() => api("/api/admin/quote", "POST", { startAt: fromLocalInput(f.startAt), endAt: fromLocalInput(f.endAt) }).then((q) => setNewQuote(q.totalCents)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [f.startAt, f.endAt, f.status, timesChanged]); // eslint-disable-line

  async function save(status?: string) {
    setErr(""); setConflicts([]); setBusy(true);
    try {
      const body: any = { startAt: fromLocalInput(f.startAt), endAt: fromLocalInput(f.endAt), status: status ?? f.status, name: f.name, apartment: f.apartment, carBrand: f.carBrand, carModel: f.carModel, carColor: f.carColor, plate: f.plate, notes: f.notes };
      if (mode.id && valueEdited) body.totalCents = Math.round(Number(f.total) * 100);
      if (mode.id && timesChanged && !valueEdited) body.priceMode = priceMode;
      if (!mode.id && f.total !== "") body.totalCents = Math.round(Number(f.total) * 100);
      await api(mode.id ? `/api/admin/reservations/${mode.id}` : "/api/admin/reservations", mode.id ? "PATCH" : "POST", body);
      onSaved();
    } catch (e) { setErr((e as Error).message); setConflicts(e instanceof ApiError ? e.conflicts : []); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm("Excluir esta reserva? Ela some das listas, mas o histórico é preservado.")) return;
    await api(`/api/admin/reservations/${mode.id}`, "DELETE"); onSaved();
  }
  async function upload(file?: File) {
    if (!file || !mode.id) return; setErr("");
    try {
      const fd = new FormData(); fd.append("file", await shrink(file), "foto.jpg");
      const r = await fetch(`/api/admin/reservations/${mode.id}/photos`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).error);
      await load();
    } catch (e) { setErr((e as Error).message); }
    if (fileRef.current) fileRef.current.value = "";
  }

  const block = f.status === "bloqueada";
  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-asfalto/60 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[94vh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-t-2xl bg-white p-5 sm:rounded-2xl">
        <h2 className="text-xl font-bold">{mode.id ? `Reserva #${mode.id.slice(0, 8).toUpperCase()}` : mode.kind === "bloqueio" ? "Bloquear garagem" : "Nova reserva manual"}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 sm:col-span-1">Entrada<input type="datetime-local" className={inp} value={f.startAt} onChange={set("startAt")} /></label>
          <label className="col-span-2 sm:col-span-1">Saída<input type="datetime-local" className={inp} value={f.endAt} onChange={set("endAt")} /></label>
          <label>Status gravado<select className={inp} value={f.status} onChange={set("status")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>{detail && effectiveStatus(detail) !== f.status && <span className="text-xs text-asfalto/60">Exibido como “{effectiveStatus(detail).replace("_", " ")}” (automático, pelo horário; nada é alterado no registro)</span>}</label>
          {!block && <label>Valor cobrado (R$){mode.id ? "" : " — vazio = calcular"}<input type="number" step="0.01" className={inp} value={f.total} onChange={set("total")} /></label>}
          {!block && <>
            <label>Responsável<input className={inp} value={f.name} onChange={set("name")} /></label>
            <label>Apartamento<input className={inp} value={f.apartment} onChange={set("apartment")} /></label>
            <label>Marca<input className={inp} value={f.carBrand} onChange={set("carBrand")} /></label>
            <label>Modelo<input className={inp} value={f.carModel} onChange={set("carModel")} /></label>
            <label>Cor<input className={inp} value={f.carColor} onChange={set("carColor")} /></label>
            <label>Placa<input className={inp} value={f.plate} onChange={set("plate")} placeholder="ABC1D23" /></label>
          </>}
          <label className="col-span-2">{block ? "Motivo (não aparece para vizinhos)" : "Observações"}<textarea rows={2} className={inp} value={f.notes} onChange={set("notes")} /></label>
        </div>

        {mode.id && detail && !timesChanged && !block && <PriceBreakdown breakdown={detail.price_breakdown} chargedCents={detail.total_cents} className="rounded-xl bg-concreto p-3" />}
        {mode.id && detail && timesChanged && !valueEdited && !block && (
          <fieldset className="rounded-xl border border-faixa bg-faixa/10 p-3">
            <legend className="px-1 font-semibold">Horário alterado — e o valor?</legend>
            <p className="text-sm">Valor contratado: <b>{brl(detail.total_cents)}</b>. {newQuote !== null ? <>O novo horário resultaria em <b>{brl(newQuote)}</b> com os preços atuais.</> : "Calculando…"}</p>
            <label className="mt-1 block"><input type="radio" checked={priceMode === "keep"} onChange={() => setPriceMode("keep")} /> Manter valor atual ({brl(detail.total_cents)})</label>
            <label className="block"><input type="radio" checked={priceMode === "recalc"} onChange={() => setPriceMode("recalc")} /> Recalcular valor{newQuote !== null ? ` (${brl(newQuote)})` : ""}</label>
          </fieldset>
        )}
        {mode.id && detail && <>
          <div>
            <div className="flex items-center justify-between"><h3 className="font-semibold">Fotos (privadas)</h3>
              <label className="cursor-pointer rounded-lg border border-asfalto/20 px-3 py-1.5">+ Adicionar
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files?.[0])} /></label></div>
            {detail.photos.length === 0 && <p className="mt-2 text-sm text-asfalto/60">Nenhuma foto ainda.</p>}
            <div className="mt-2 grid grid-cols-3 gap-2">{detail.photos.map((p: string) => <div key={p} className="relative"><a href={`/api/admin/photos/${p}`} target="_blank"><img src={`/api/admin/photos/${p}`} alt="Foto do veículo" className="aspect-square w-full rounded-lg object-cover" /></a><button aria-label="Remover foto" onClick={async () => { if (confirm("Remover esta foto?")) { await api(`/api/admin/photos/${p}`, "DELETE"); load(); } }} className="absolute right-1 top-1 rounded-full bg-asfalto/80 px-2 text-white">×</button></div>)}</div>
          </div>
          <div>
            <h3 className="font-semibold">Histórico</h3>
            <ul className="mt-1 space-y-1 text-sm">
              {detail.events.map((e: any, i: number) => <li key={i}><span className="text-asfalto/60">{fmtDT(e.created_at)} • {e.actor}</span><br />{describe(e)}</li>)}
            </ul>
          </div>
        </>}

        {err && <div role="alert" className="rounded-lg bg-ocupado/10 p-3 text-ocupado">{err.split(". Conflito")[0]}{conflicts.length > 0 && <div className="mt-2 space-y-1">{conflicts.map((c) => <button key={c.id} onClick={() => onOpen(c.id)} className="block text-left underline">Abrir: {c.label}</button>)}<span className="text-sm">Abra a reserva em conflito para cancelá-la ou ajustá-la e tente novamente.</span></div>}</div>}
        <div className="sticky bottom-0 -mx-5 -mb-5 flex flex-wrap gap-2 border-t border-asfalto/10 bg-white px-5 py-3">
          <button disabled={busy || !f.startAt || !f.endAt} onClick={() => save()} className="rounded-lg bg-asfalto px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
          {mode.id && block && <button disabled={busy} onClick={() => confirm("Remover este bloqueio? O horário volta a ficar disponível.") && save("cancelada")} className="rounded-lg border border-ocupado px-3 py-2.5 text-ocupado">Remover bloqueio</button>}
          {mode.id && !block && <>
            <button disabled={busy} onClick={() => save("confirmada")} className="rounded-lg border border-livre px-3 py-2.5 text-livre">Confirmar</button>
            <button disabled={busy} onClick={() => save("irregular")} className="rounded-lg border border-faixa px-3 py-2.5">Marcar irregular</button>
            <button disabled={busy} onClick={() => confirm("Cancelar esta reserva?") && save("cancelada")} className="rounded-lg border border-ocupado px-3 py-2.5 text-ocupado">Cancelar</button>
          </>}
          {mode.id && <button onClick={remove} className="px-3 py-2.5 text-ocupado underline">Excluir</button>}
          <button onClick={onClose} className="ml-auto px-3 py-2.5">Fechar</button>
        </div>
      </div>
    </div>
  );
}
