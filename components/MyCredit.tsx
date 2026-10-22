"use client";
import { useEffect, useState } from "react";
import { brl } from "@/lib/pricing";
import { loadProfile } from "@/lib/profile";
import { prepareReceipt } from "@/lib/image";
import type { PixConfig } from "@/lib/pix";
import PixBox from "./PixBox";

// "Meu crédito" do vizinho: saldo, extrato, pedir crédito (com comprovante) e acompanhar os pedidos.
// O saldo e o extrato só aparecem para quem já tem algo confirmado NESTE aparelho (reserva paga ou pedido confirmado).
type Req = { id: string; amountCents: number; status: string; adminNote: string | null; createdAt: string; receiptCount: number; confirmedCents: number | null };
type Mov = { at: string; amountCents: number; balanceCents: number; type: string; label: string; reservation: { start: string; end: string } | null };
type Data = { owner: { name: string } | null; balanceCents: number; movements: Mov[]; requests: Req[] };

const fmt = (s: string) => new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
const field = "w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2";
const STATUS: Record<string, [string, string]> = {
  pendente: ["Aguardando confirmação", "bg-faixa/30"], confirmado: ["Confirmado", "bg-livre/15 text-livre"],
  recusado: ["Recusado", "bg-ocupado/10 text-ocupado"], cancelado: ["Cancelado", "bg-asfalto/10 text-asfalto/60"],
};

async function sendReceipt(id: string, file: File) {
  const { blob, name } = await prepareReceipt(file);
  const fd = new FormData(); fd.append("file", blob, name);
  const r = await fetch(`/api/creditos/${id}/comprovante`, { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Não foi possível enviar o comprovante.");
}

export default function MyCredit({ onChange }: { onChange?: () => void }) {
  const [d, setD] = useState<Data | null>(null); const [pix, setPix] = useState<PixConfig | null>(null);
  const [open, setOpen] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState("");
  const load = () => fetch("/api/creditos").then((r) => r.json()).then(setD).catch(() => {});
  useEffect(() => { load(); fetch("/api/config").then((r) => r.json()).then((c) => setPix(c.pix ?? null)).catch(() => {}); }, []);

  async function upload(id: string, file?: File) {
    if (!file) return; setErr(""); setBusy(id);
    try { await sendReceipt(id, file); await load(); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  }
  async function cancel(id: string) {
    if (!confirm("Cancelar este pedido de crédito?")) return;
    const r = await fetch(`/api/creditos/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((await r.json()).error); else { setErr(""); load(); }
  }

  if (!d) return null;
  const pending = d.requests.filter((r) => r.status === "pendente");
  return (
    <section className="mt-8" aria-label="Meu crédito">
      <div className="flex items-center gap-2">
        <h2 className="mr-auto text-lg font-semibold">Meu crédito</h2>
        {!open && <button onClick={() => setOpen(true)} className="rounded-lg border border-livre px-3 py-1.5 text-sm font-semibold text-livre">+ Adicionar crédito</button>}
      </div>
      <div className="mt-2 rounded-xl bg-white p-4">
        {d.owner ? <>
          <div className="text-sm text-asfalto/70">Saldo disponível{d.owner.name ? ` de ${d.owner.name.split(" ")[0]}` : ""}</div>
          <div className={`text-3xl font-bold ${d.balanceCents > 0 ? "text-livre" : ""}`}>{brl(d.balanceCents)}</div>
          <p className="mt-1 text-sm text-asfalto/70">O crédito paga sozinho suas próximas reservas (e reservas pendentes). Quando cobre tudo, a reserva já fica paga.</p>
        </> : <p className="text-sm text-asfalto/70">Deixe um valor adiantado e ele paga suas próximas reservas automaticamente. O saldo aparece aqui depois que o responsável confirmar o primeiro pagamento feito por este aparelho.</p>}
        {pending.length > 0 && <p className="mt-2 text-sm">⏳ {pending.length === 1 ? "1 pedido aguardando" : `${pending.length} pedidos aguardando`} confirmação: <b>{brl(pending.reduce((t, r) => t + r.amountCents, 0))}</b></p>}
      </div>

      {open && <NewRequest pix={pix} onCancel={() => setOpen(false)} onDone={() => { setOpen(false); load(); onChange?.(); }} />}

      {d.requests.length > 0 && <>
        <h3 className="mt-4 font-semibold">Meus pedidos de crédito</h3>
        <ul className="mt-2 space-y-2">{d.requests.map((r) => {
          const [label, cls] = STATUS[r.status] ?? [r.status, ""];
          return (
            <li key={r.id} className="rounded-xl bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-base">{brl(r.amountCents)}</b><span className="text-asfalto/60">{fmt(r.createdAt)}</span>
                <span className={`ml-auto rounded-full px-2.5 py-0.5 ${cls}`}>{label}</span>
              </div>
              {r.status === "confirmado" && r.confirmedCents !== null && r.confirmedCents !== r.amountCents && <p className="mt-1">Valor confirmado: <b>{brl(r.confirmedCents)}</b></p>}
              {r.adminNote && <p className="mt-1 text-asfalto/80">Responsável: {r.adminNote}</p>}
              {r.status === "pendente" && <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-asfalto/70">{r.receiptCount ? `${r.receiptCount} comprovante${r.receiptCount > 1 ? "s" : ""} enviado${r.receiptCount > 1 ? "s" : ""}` : "Sem comprovante ainda"}</span>
                {r.receiptCount < 5 && <label className="cursor-pointer underline">{busy === r.id ? "Enviando…" : "Enviar comprovante"}
                  <input type="file" accept="image/*,application/pdf" hidden disabled={!!busy} onChange={(e) => { upload(r.id, e.target.files?.[0]); e.target.value = ""; }} /></label>}
                <button onClick={() => cancel(r.id)} className="text-ocupado underline">Cancelar pedido</button>
              </div>}
            </li>);
        })}</ul>
      </>}

      {d.owner && d.movements.length > 0 && (
        <details className="mt-3 rounded-xl bg-white p-3 text-sm">
          <summary className="cursor-pointer font-semibold">Extrato do crédito</summary>
          <table className="mt-2 w-full">
            <tbody>{[...d.movements].reverse().map((m, i) => (
              <tr key={i} className="border-t border-asfalto/10 align-top">
                <td className="whitespace-nowrap py-1.5 pr-2 text-asfalto/60">{fmt(m.at).slice(0, 10)}</td>
                <td className="py-1.5 pr-2">{m.label}{m.reservation && <span className="block text-xs text-asfalto/60">Reserva {fmt(m.reservation.start)} → {fmt(m.reservation.end)}</span>}</td>
                <td className={`py-1.5 pr-2 whitespace-nowrap text-right font-semibold ${m.amountCents >= 0 ? "text-livre" : ""}`}>{m.amountCents >= 0 ? "+" : "−"} {brl(Math.abs(m.amountCents))}</td>
                <td className="whitespace-nowrap py-1.5 text-right text-asfalto/60">{brl(m.balanceCents)}</td>
              </tr>))}</tbody>
          </table>
        </details>
      )}
      {err && <p role="alert" className="mt-2 text-ocupado">{err}</p>}
    </section>
  );
}

function NewRequest({ pix, onCancel, onDone }: { pix: PixConfig | null; onCancel: () => void; onDone: () => void }) {
  const p = loadProfile();
  const [f, setF] = useState({ value: "", name: p?.name ?? "", apartment: p?.apartment ?? "", plate: p?.plate ?? "", phone: p?.phone ?? "", note: "", website: "" });
  const [file, setFile] = useState<File | null>(null); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setErr(""); setF({ ...f, [k]: e.target.value }); };
  const cents = Math.round(Number(f.value.replace(",", ".")) * 100) || 0;
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const { value, ...rest } = f;
      const r = await fetch("/api/creditos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...rest, amountCents: cents }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? "Não foi possível enviar o pedido.");
      if (file) await sendReceipt(j.id, file).catch((x) => { throw new Error(`Pedido enviado, mas o comprovante não: ${(x as Error).message} Envie de novo pela lista.`); });
      onDone();
    } catch (x) { setErr((x as Error).message); }
    setBusy(false);
  }
  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-xl border border-livre/40 bg-white p-4">
      <h3 className="font-semibold">Adicionar crédito</h3>
      <p className="text-sm text-asfalto/70">1) Faça o PIX do valor. 2) Envie o pedido com o comprovante. 3) O responsável confere e o crédito entra no seu saldo.</p>
      <label className="block">Valor (R$)<input className={field} inputMode="decimal" value={f.value} onChange={set("value")} placeholder="ex.: 60,00" required /></label>
      {cents >= 100 && <PixBox pix={pix} totalCents={cents} />}
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2">Nome do responsável<input className={field} value={f.name} onChange={set("name")} required /></label>
        <label>Apartamento<input className={field} value={f.apartment} onChange={set("apartment")} required /></label>
        <label>Placa <span className="text-asfalto/60">(opcional)</span><input className={field} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} maxLength={8} /></label>
        <label className="col-span-2">WhatsApp <span className="text-asfalto/60">(opcional)</span><input className={field} type="tel" maxLength={25} value={f.phone} onChange={set("phone")} /></label>
        <label className="col-span-2">Recado <span className="text-asfalto/60">(opcional)</span><input className={field} maxLength={300} value={f.note} onChange={set("note")} placeholder="ex.: PIX das 10h" /></label>
      </div>
      <p className="text-xs text-asfalto/60">Use o mesmo nome e apartamento das suas reservas: é assim que o crédito sabe que é seu.</p>
      <label className="block text-sm">Comprovante (foto/print ou PDF, até 2 MB) <span className="text-asfalto/60">— pode enviar depois</span>
        <input type="file" accept="image/*,application/pdf" className="mt-1 block text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set("website")} className="absolute -left-[9999px]" />
      {err && <p role="alert" className="rounded-lg bg-ocupado/10 p-3 text-ocupado">{err}</p>}
      <div className="flex gap-3">
        <button type="button" onClick={onCancel} className="flex-1 rounded-lg border border-asfalto/20 px-4 py-2.5">Cancelar</button>
        <button disabled={busy || cents < 100} className="flex-1 rounded-lg bg-livre px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? "Enviando…" : "Enviar pedido"}</button>
      </div>
    </form>
  );
}
