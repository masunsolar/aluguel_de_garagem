"use client";
import { useEffect, useRef, useState } from "react";
import { brl } from "@/lib/pricing";
import { effectiveStatus } from "@/lib/status";
import PriceBreakdown from "../PriceBreakdown";
import { api, ApiError, fmtDT, fromLocalInput, toLocalInput } from "@/lib/client";
import { shrink } from "@/lib/image";
import { chargeMessage, waLink, waNumber } from "@/lib/whatsapp";

// "sem_agenda": alguém estacionou sem reservar no site. Já abre como irregular, entrada agora e taxa ligada.
export type Mode = { id?: string; kind?: "manual" | "bloqueio" | "sem_agenda" };
type Resident = { key: string; name: string; apartment: string | null; phone: string | null; carBrand: string | null; carModel: string | null;
  carColor: string | null; plate: string | null; plates: string[]; uses: number; lastUse: string; pendingCents: number; pendingCount: number; creditCents?: number };
const STATUSES = ["pendente", "confirmada", "em_andamento", "finalizada", "cancelada", "irregular", "bloqueada"];
const inp = "mt-1 w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2";
const blank = { startAt: "", endAt: "", status: "confirmada", name: "", apartment: "", carBrand: "", carModel: "", carColor: "", plate: "", phone: "", notes: "", total: "", fee: "" };
const cents = (v: string) => Math.round(Number(v || 0) * 100);

function describe(e: any) {
  const d = e.details ?? {};
  if (e.action === "criada") return "Reserva criada pelo vizinho";
  if (e.action === "bloqueio_criado") return "Horário bloqueado pelo administrador";
  if (e.action === "foto_removida") return "Foto removida pelo administrador";
  if (e.action === "criada_manualmente") return `Registro criado manualmente pelo administrador${d.taxa ? ` (inclui taxa de ${d.taxa})` : ""}`;
  if (e.action === "status_alterado") return `${d.from === "bloqueada" ? "Bloqueio removido" : d.to === "confirmada" ? "Confirmada" : d.to === "cancelada" ? "Cancelada" : d.to === "irregular" ? "Marcada como irregular" : `Status: ${d.to}`}${d.from ? ` (antes: ${d.from})` : ""}${Object.keys(d.changes ?? {}).length ? " • " + Object.entries<any>(d.changes).map(([k, v]) => `${k}: ${v.from ?? "—"} → ${v.to ?? "—"}`).join(" • ") : ""}`;
  if (e.action === "foto_adicionada") return "Foto adicionada pelo administrador";
  if (e.action === "cobranca_aberta") return `Cobrança aberta no WhatsApp (${d.itens ?? 1} reserva${(d.itens ?? 1) > 1 ? "s" : ""}, ${d.total ?? ""})`;
  if (e.action === "comprovante_enviado") return "Comprovante de pagamento enviado pelo vizinho";
  if (e.action === "excluida") return "Excluída pelo administrador";
  if (e.action === "pagamento_registrado") return `Pagamento registrado: recebido ${brl(d.recebido_cents)} (faltavam ${brl(d.devido_cents)})${d.obs ? ` • ${d.obs}` : ""}`;
  if (e.action === "credito_usado") return `Crédito abatido: ${brl(d.valor_cents)}${d.quitou ? " (quitou a reserva)" : ""}`;
  if (e.action === "credito_devolvido") return `Crédito devolvido para a pessoa: ${brl(d.valor_cents)}`;
  if (e.action === "credito_lancado") return `Crédito avulso lançado: ${brl(d.valor_cents)}${d.obs ? ` • ${d.obs}` : ""}`;
  if (e.action === "credito_baixa") return `Baixa de crédito: ${brl(d.valor_cents)}${d.obs ? ` • ${d.obs}` : ""}`;
  if (e.action === "editada") return Object.entries<any>(d.changes ?? {}).map(([k, v]) => `${k}: ${v.from ?? "—"} → ${v.to ?? "—"}`).join(" • ") + (d.preco ? ` (valor ${d.preco})` : "");
  return e.action;
}

export default function Editor({ mode, onClose, onSaved, onOpen }: { mode: Mode; onClose: () => void; onSaved: () => void; onOpen: (id: string) => void }) {
  const [f, setF] = useState({ ...blank, status: mode.kind === "bloqueio" ? "bloqueada" : mode.kind === "sem_agenda" ? "irregular" : "confirmada",
    startAt: mode.kind === "sem_agenda" ? toLocalInput(new Date().toISOString()).slice(0, 14) + "00" : "" });
  const [feeOn, setFeeOn] = useState(mode.kind === "sem_agenda"); const [residents, setResidents] = useState<Resident[]>([]); const [who, setWho] = useState(""); const [defaultFee, setDefaultFee] = useState("");
  const [detail, setDetail] = useState<any>(null); const [pixKey, setPixKey] = useState(""); const [chargeTpl, setChargeTpl] = useState("");
  const [priceMode, setPriceMode] = useState<"keep" | "recalc">("keep"); const [newQuote, setNewQuote] = useState<number | null>(null);
  const [err, setErr] = useState(""); const [conflicts, setConflicts] = useState<{ id: string; label: string }[]>([]); const [busy, setBusy] = useState(false);
  const [recv, setRecv] = useState(""); const [creditAdd, setCreditAdd] = useState(""); const [creditNote, setCreditNote] = useState("");
  const [info, setInfo] = useState(""); const [dirty, setDirty] = useState(false); // dirty: mudou algo sem fechar => recarregar a lista ao fechar
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });

  const load = async () => {
    if (!mode.id) return;
    const d = await api(`/api/admin/reservations/${mode.id}`); setDetail(d);
    const fee = d.fee_cents ?? 0; // o total gravado já inclui a taxa; no formulário uso e taxa ficam separados
    setF({ startAt: toLocalInput(d.start_at), endAt: toLocalInput(d.end_at), status: d.status, name: d.name ?? "", apartment: d.apartment ?? "", carBrand: d.car_brand ?? "", carModel: d.car_model ?? "", carColor: d.car_color ?? "", plate: d.plate ?? "", phone: d.phone ?? "", notes: d.notes ?? "", total: ((d.total_cents - fee) / 100).toFixed(2), fee: fee ? (fee / 100).toFixed(2) : "" });
    setFeeOn(fee > 0);
    setRecv(((d.total_cents - (d.credit_cents ?? 0)) / 100).toFixed(2)); // valor recebido sugerido = o que falta pagar
  };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, []); // eslint-disable-line
  useEffect(() => { api("/api/admin/settings").then((c) => {
    setPixKey(c.pix?.key ?? ""); setChargeTpl(c.chargeTemplate ?? "");
    const sug = Number(c.noBookingFee ?? 0).toFixed(2); setDefaultFee(sug); // taxa sugerida das Configurações
    if (!mode.id) setF((p) => ({ ...p, fee: p.fee || sug }));
  }).catch(() => {}); }, []); // eslint-disable-line
  useEffect(() => { if (mode.kind !== "bloqueio") api("/api/admin/residents").then(setResidents).catch(() => {}); }, []); // eslint-disable-line
  // Vincular a um morador que já usou: preenche os dados com os da última vez (dá para ajustar depois)
  function pickResident(key: string) {
    setWho(key); const r = residents.find((x) => x.key === key); if (!r) return;
    setF((p) => ({ ...p, name: r.name, apartment: r.apartment ?? "", phone: r.phone ?? "", carBrand: r.carBrand ?? "", carModel: r.carModel ?? "", carColor: r.carColor ?? "", plate: r.plate ?? "" }));
  }
  const picked = residents.find((x) => x.key === who);

  const timesChanged = !!detail && !!f.startAt && !!f.endAt && (f.startAt !== toLocalInput(detail.start_at) || f.endAt !== toLocalInput(detail.end_at));
  const feeCents = feeOn ? cents(f.fee) : 0;
  const valueEdited = !!detail && f.total !== "" && cents(f.total) !== detail.total_cents - (detail.fee_cents ?? 0);
  const feeEdited = !!detail && feeCents !== (detail.fee_cents ?? 0);
  useEffect(() => { // cotação com os preços ATUAIS, só para informar; nada é gravado
    setNewQuote(null);
    if (!timesChanged || f.status === "bloqueada") return;
    const t = setTimeout(() => api("/api/admin/quote", "POST", { startAt: fromLocalInput(f.startAt), endAt: fromLocalInput(f.endAt) }).then((q) => setNewQuote(q.totalCents)).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [f.startAt, f.endAt, f.status, timesChanged]); // eslint-disable-line

  async function save(status?: string, paymentStatus?: "pendente" | "pago") {
    setErr(""); setConflicts([]); setBusy(true);
    try {
      const body: any = { startAt: fromLocalInput(f.startAt), endAt: fromLocalInput(f.endAt), status: status ?? f.status, name: f.name, apartment: f.apartment, carBrand: f.carBrand, carModel: f.carModel, carColor: f.carColor, plate: f.plate, phone: f.phone, notes: f.notes };
      if (mode.id && valueEdited) body.totalCents = cents(f.total);
      if (mode.id && timesChanged && !valueEdited) body.priceMode = priceMode;
      if (!mode.id && f.total !== "") body.totalCents = cents(f.total);
      if ((!mode.id && feeCents > 0) || feeEdited) body.feeCents = feeCents;
      if (paymentStatus) body.paymentStatus = paymentStatus;
      await api(mode.id ? `/api/admin/reservations/${mode.id}` : "/api/admin/reservations", mode.id ? "PATCH" : "POST", body);
      onSaved();
    } catch (e) { setErr((e as Error).message); setConflicts(e instanceof ApiError ? e.conflicts : []); } finally { setBusy(false); }
  }
  // Pagamento com valor e crédito: o editor continua aberto mostrando o resultado (a lista recarrega ao fechar).
  async function creditCall(url: string, body: unknown, done: (r: any) => string) {
    setErr(""); setInfo(""); setBusy(true);
    try { const r = await api(url, "POST", body); setInfo(done(r)); setDirty(true); await load(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  const registerPay = () => creditCall(`/api/admin/reservations/${mode.id}/pagamento`, { receivedCents: cents(recv) }, (r) =>
    [r.paid ? "Reserva quitada." : `Abatido ${brl(r.usedHereCents)}; ainda falta pagar.`,
     r.otherReservationsCents ? `${brl(r.otherReservationsCents)} pagaram outras reservas pendentes da pessoa.` : "",
     r.creditLeftCents ? `Crédito guardado para a pessoa: ${brl(r.creditLeftCents)}.` : ""].filter(Boolean).join(" "));
  const useCredit = () => creditCall(`/api/admin/reservations/${mode.id}/credito`, { action: "usar" }, (r) =>
    `Crédito abatido: ${brl(r.usedCents)}${r.paid ? " (reserva quitada)" : ""}. Saldo restante: ${brl(r.creditLeftCents)}.`);
  const launchCredit = () => creditCall(`/api/admin/reservations/${mode.id}/credito`, { action: "lancar", amountCents: cents(creditAdd), note: creditNote || null }, (r) => {
    setCreditAdd(""); setCreditNote("");
    return `Crédito lançado.${r.usedCents ? ` ${brl(r.usedCents)} já pagaram reservas pendentes da pessoa.` : ""} Saldo: ${brl(r.creditLeftCents)}.`; });
  function writeOff(lot: any) {
    const note = prompt(`Zerar o saldo de ${brl(lot.remainingCents)} deste crédito? Use quando o dinheiro foi devolvido ao vizinho ou lançado por engano.\n\nMotivo (opcional):`);
    if (note === null) return;
    creditCall(`/api/admin/creditos/${lot.id}/baixa`, { note: note.trim() || null }, (r) => `Baixa de ${brl(r.removedCents)} registrada.`);
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

  // Cobrança: abre o WhatsApp com a mensagem pronta (o admin confere e envia). Registra no histórico que foi aberta.
  function charge() {
    const items = detail?.charge ?? [];
    if (!items.length) return;
    const url = waLink(f.phone, chargeMessage(f.name, items, pixKey, chargeTpl));
    window.open(url, "_blank", "noopener");
    api(`/api/admin/reservations/${mode.id}/cobranca`, "POST").then(load).catch(() => {}); // só histórico; falhar aqui não impede a cobrança
  }

  const block = f.status === "bloqueada";
  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-asfalto/60 sm:items-center" role="dialog" aria-modal="true">
      <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl">
        {/* Só o miolo rola; o rodapé fica fora da rolagem e nunca cobre o histórico (dvh = altura real no celular) */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5">
          <h2 className="text-xl font-bold">{mode.id ? `Reserva #${mode.id.slice(0, 8).toUpperCase()}` : mode.kind === "bloqueio" ? "Bloquear garagem" : mode.kind === "sem_agenda" ? "Estacionou sem agendar" : "Nova reserva manual"}</h2>
          {!block && residents.length > 0 && (
            <label className="block rounded-xl bg-concreto p-3">Vincular a um morador que já usou
              <select className={inp} value={who} onChange={(e) => pickResident(e.target.value)}>
                <option value="">{mode.id ? "— manter os dados abaixo —" : "— escolher (preenche os dados) —"}</option>
                {residents.map((r) => <option key={r.key} value={r.key}>{r.name}{r.apartment ? ` • Apto ${r.apartment}` : ""}{r.plates.length ? ` • ${r.plates.join(", ")}` : ""} — {r.uses}x, última {fmtDT(r.lastUse).slice(0, 5)}{r.pendingCount ? ` • ${r.pendingCount} em aberto (${brl(r.pendingCents)})` : ""}{r.creditCents ? ` • crédito ${brl(r.creditCents)}` : ""}</option>)}
              </select>
              {picked && <span className="mt-1 block text-sm">{[picked.carBrand, picked.carModel, picked.carColor].filter(Boolean).join(" ")}{picked.phone ? ` • WhatsApp ${picked.phone}` : ""}{picked.pendingCount ? <b className="text-ocupado"> • já deve {brl(picked.pendingCents)} ({picked.pendingCount})</b> : ""}{picked.creditCents ? <b className="text-livre"> • tem {brl(picked.creditCents)} de crédito (abate sozinho)</b> : ""}</span>}
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 sm:col-span-1">Entrada<input type="datetime-local" className={inp} value={f.startAt} onChange={set("startAt")} /></label>
            <label className="col-span-2 sm:col-span-1">Saída<input type="datetime-local" className={inp} value={f.endAt} onChange={set("endAt")} /></label>
            <label>Status gravado<select className={inp} value={f.status} onChange={set("status")}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>{detail && effectiveStatus(detail) !== f.status && <span className="text-xs text-asfalto/60">Exibido como “{effectiveStatus(detail).replace("_", " ")}” (automático, pelo horário; nada é alterado no registro)</span>}</label>
            {!block && <label>Valor do uso (R$){mode.id ? "" : " — vazio = calcular"}<input type="number" step="0.01" className={inp} value={f.total} onChange={set("total")} /></label>}
            {!block && (
              <div className="col-span-2 rounded-xl border border-asfalto/15 p-3">
                <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={feeOn} onChange={(e) => { setFeeOn(e.target.checked); if (e.target.checked && !Number(f.fee)) setF((p) => ({ ...p, fee: defaultFee })); }} /> Taxa por estacionar sem agendar</label>
                {feeOn && <label className="mt-2 block text-sm">Valor da taxa (R$) — somado ao uso e mostrado separado na cobrança<input type="number" step="0.01" min={0} className={inp + " max-w-40"} value={f.fee} onChange={set("fee")} /></label>}
              </div>
            )}
            {!block && <>
              <label>Responsável<input className={inp} value={f.name} onChange={set("name")} /></label>
              <label>Apartamento<input className={inp} value={f.apartment} onChange={set("apartment")} /></label>
              <label>Marca<input className={inp} value={f.carBrand} onChange={set("carBrand")} /></label>
              <label>Modelo<input className={inp} value={f.carModel} onChange={set("carModel")} /></label>
              <label>Cor<input className={inp} value={f.carColor} onChange={set("carColor")} /></label>
              <label>Placa<input className={inp} value={f.plate} onChange={set("plate")} placeholder="ABC1D23" /></label>
              <label className="col-span-2 sm:col-span-1">WhatsApp<input className={inp} type="tel" inputMode="tel" maxLength={25} value={f.phone} onChange={set("phone")} placeholder="(43) 99999-8888" /></label>
            </>}
            <label className="col-span-2">{block ? "Motivo (não aparece para vizinhos)" : "Observações"}<textarea rows={2} className={inp} value={f.notes} onChange={set("notes")} /></label>
          </div>

          {mode.id && detail && !timesChanged && !block && <div className="rounded-xl bg-concreto p-3"><PriceBreakdown breakdown={detail.price_breakdown} chargedCents={detail.total_cents - (detail.fee_cents ?? 0)} />
            {detail.fee_cents > 0 && <p className="mt-1 text-sm">+ Taxa por estacionar sem agendar: <b>{brl(detail.fee_cents)}</b> • Total cobrado: <b>{brl(detail.total_cents)}</b></p>}</div>}
          {mode.id && detail && timesChanged && !valueEdited && !block && (
            <fieldset className="rounded-xl border border-faixa bg-faixa/10 p-3">
              <legend className="px-1 font-semibold">Horário alterado — e o valor?</legend>
              <p className="text-sm">Valor do uso contratado: <b>{brl(detail.total_cents - (detail.fee_cents ?? 0))}</b>{detail.fee_cents > 0 ? ` (+ taxa ${brl(detail.fee_cents)}, que se mantém)` : ""}. {newQuote !== null ? <>O novo horário resultaria em <b>{brl(newQuote)}</b> com os preços atuais.</> : "Calculando…"}</p>
              <label className="mt-1 block"><input type="radio" checked={priceMode === "keep"} onChange={() => setPriceMode("keep")} /> Manter valor atual ({brl(detail.total_cents - (detail.fee_cents ?? 0))})</label>
              <label className="block"><input type="radio" checked={priceMode === "recalc"} onChange={() => setPriceMode("recalc")} /> Recalcular valor{newQuote !== null ? ` (${brl(newQuote)})` : ""}</label>
            </fieldset>
          )}
          {mode.id && detail && <>
            {!block && (
              <div className={`rounded-xl border p-3 ${detail.payment_status === "pago" ? "border-livre bg-livre/10" : "border-faixa bg-faixa/10"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto font-semibold">Pagamento: {detail.payment_status === "pago" ? <span className="text-livre">pago{detail.paid_at ? ` em ${fmtDT(detail.paid_at)}` : ""}</span> : "pendente"}</h3>
                  {detail.payment_status === "pago"
                    ? <button disabled={busy} onClick={() => save(undefined, "pendente")} className="rounded-lg border border-asfalto/30 px-3 py-1.5 text-sm">Voltar para pendente</button>
                    : <>
                      {detail.charge?.length > 0 && <button disabled={busy} onClick={charge} title={waNumber(f.phone) ? `Abrir conversa com ${f.phone}` : "Sem WhatsApp cadastrado: você escolhe o contato"} className="rounded-lg border border-livre bg-white px-3 py-1.5 text-sm font-semibold text-livre">Cobrar no WhatsApp</button>}
                    </>}
                </div>
                {detail.credit_cents > 0 && <p className="mt-1 text-sm">Já abatido com crédito/pagamento: <b>{brl(detail.credit_cents)}</b> de {brl(detail.total_cents)}{detail.payment_status !== "pago" && <> • falta <b>{brl(detail.total_cents - detail.credit_cents)}</b></>}</p>}
                {detail.payment_status !== "pago" && detail.total_cents <= detail.credit_cents && // nada a receber (valor zero ou já coberto)
                  <button disabled={busy} onClick={() => save(undefined, "pago")} className="mt-2 rounded-lg bg-livre px-3 py-1.5 text-sm font-semibold text-white">Marcar como pago</button>}
                {detail.payment_status !== "pago" && !["cancelada"].includes(f.status) && detail.total_cents > detail.credit_cents && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-white p-2">
                    <label className="text-sm">Valor recebido (R$)<input type="number" step="0.01" min={0.01} className={inp + " max-w-36"} value={recv} onChange={(e) => setRecv(e.target.value)} /></label>
                    <button disabled={busy || cents(recv) <= 0} onClick={registerPay} className="rounded-lg bg-livre px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Registrar pagamento</button>
                    <span className="basis-full text-xs text-asfalto/60">Recebeu a mais? O que sobrar paga outras pendências da pessoa e o resto fica como crédito. Recebeu menos? Abate o que veio e o restante continua pendente.</span>
                  </div>
                )}
                {detail.payment_status !== "pago" && detail.charge?.length > 1 && <p className="mt-1 text-sm">Esta pessoa tem <b>{detail.charge.length}</b> reservas em aberto (mesmo nome, placa ou apartamento); a cobrança inclui todas.</p>}
                {detail.payment_status !== "pago" && detail.charge?.length > 0 && !waNumber(f.phone) && <p className="mt-1 text-xs text-asfalto/60">Sem WhatsApp válido cadastrado: o WhatsApp abre para você escolher o contato.</p>}
                {detail.receipts.length === 0 ? <p className="mt-1 text-sm text-asfalto/60">Nenhum comprovante enviado pelo vizinho.</p> : (
                  <div className="mt-2 flex flex-wrap gap-2">{detail.receipts.map((c: any) => (
                    <a key={c.id} href={`/api/admin/receipts/${c.id}`} target="_blank" className="block w-24 text-center text-xs underline">
                      {c.mime === "application/pdf" ? <div className="flex aspect-square items-center justify-center rounded-lg bg-white text-2xl">📄</div> : <img src={`/api/admin/receipts/${c.id}`} alt="Comprovante" className="aspect-square w-full rounded-lg object-cover" />}
                      {fmtDT(c.created_at)}
                    </a>))}</div>
                )}
              </div>
            )}
            {!block && detail.credit && (
              <div className="rounded-xl border border-asfalto/15 p-3">
                <h3 className="font-semibold">Crédito desta pessoa: <span className={detail.credit.balanceCents > 0 ? "text-livre" : ""}>{brl(detail.credit.balanceCents)}</span></h3>
                <p className="text-xs text-asfalto/60">Dono do crédito = mesmo nome e mesmo apartamento ou placa. O crédito paga sozinho as reservas pendentes dela (menos as com comprovante a conferir).</p>
                {detail.credit.lots.length > 0 && <ul className="mt-2 space-y-1 text-sm">{detail.credit.lots.map((l: any) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2"><span className="mr-auto">{fmtDT(l.createdAt).slice(0, 10)} • {l.kind === "pagamento" ? "sobra de pagamento" : "lançado avulso"} de {brl(l.amountCents)}{l.note ? ` • ${l.note}` : ""} → saldo <b>{brl(l.remainingCents)}</b>{l.name || l.apartment ? ` (${[l.name, l.apartment && `apto ${l.apartment}`].filter(Boolean).join(", ")})` : ""}</span>
                    <button disabled={busy} onClick={() => writeOff(l)} className="text-xs text-ocupado underline">dar baixa</button></li>))}</ul>}
                {detail.credit.uses.length > 0 && <p className="mt-2 text-sm">Nesta reserva: {detail.credit.uses.map((u: any) => `${u.amountCents > 0 ? "abatido" : "devolvido"} ${brl(Math.abs(u.amountCents))} em ${fmtDT(u.createdAt).slice(0, 10)}`).join(" • ")}</p>}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {detail.credit.balanceCents > 0 && detail.payment_status !== "pago" && detail.total_cents > detail.credit_cents && f.status !== "cancelada" &&
                    <button disabled={busy} onClick={useCredit} className="rounded-lg border border-livre px-3 py-2 text-sm text-livre">Usar crédito nesta reserva</button>}
                  <label className="text-sm">Lançar crédito (R$)<input type="number" step="0.01" min={0.01} className={inp + " max-w-28"} value={creditAdd} onChange={(e) => setCreditAdd(e.target.value)} /></label>
                  <label className="min-w-40 flex-1 text-sm">Observação<input className={inp} maxLength={300} value={creditNote} onChange={(e) => setCreditNote(e.target.value)} placeholder="ex.: PIX de 22/10 sem reserva" /></label>
                  <button disabled={busy || cents(creditAdd) <= 0} onClick={launchCredit} className="rounded-lg border border-asfalto/30 px-3 py-2 text-sm disabled:opacity-50">Lançar</button>
                </div>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between"><h3 className="font-semibold">Fotos (privadas)</h3>
                <label className="cursor-pointer rounded-lg border border-asfalto/20 px-3 py-1.5">+ Adicionar
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} /></label></div>
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

        </div>
        {info && <div role="status" className="mx-5 mb-2 shrink-0 rounded-lg bg-livre/10 p-3 text-sm text-livre">{info}</div>}
        {err && <div role="alert" className="mx-5 mb-2 max-h-40 shrink-0 overflow-y-auto rounded-lg bg-ocupado/10 p-3 text-ocupado">{err.split(". Conflito")[0]}{conflicts.length > 0 && <div className="mt-2 space-y-1">{conflicts.map((c) => <button key={c.id} onClick={() => onOpen(c.id)} className="block text-left underline">Abrir: {c.label}</button>)}<span className="text-sm">Abra a reserva em conflito para cancelá-la ou ajustá-la e tente novamente.</span></div>}</div>}
        <div className="flex shrink-0 flex-wrap gap-2 border-t border-asfalto/10 bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button disabled={busy || !f.startAt || !f.endAt} onClick={() => save()} className="rounded-lg bg-asfalto px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
          {mode.id && block && <button disabled={busy} onClick={() => confirm("Remover este bloqueio? O horário volta a ficar disponível.") && save("cancelada")} className="rounded-lg border border-ocupado px-3 py-2.5 text-ocupado">Remover bloqueio</button>}
          {mode.id && !block && <>
            <button disabled={busy} onClick={() => save("confirmada")} className="rounded-lg border border-livre px-3 py-2.5 text-livre">Confirmar</button>
            <button disabled={busy} onClick={() => save("irregular")} className="rounded-lg border border-faixa px-3 py-2.5">Marcar irregular</button>
            <button disabled={busy} onClick={() => confirm("Cancelar esta reserva?") && save("cancelada")} className="rounded-lg border border-ocupado px-3 py-2.5 text-ocupado">Cancelar</button>
          </>}
          {mode.id && <button onClick={remove} className="px-3 py-2.5 text-ocupado underline">Excluir</button>}
          <button onClick={dirty ? onSaved : onClose} className="ml-auto px-3 py-2.5">Fechar</button>
        </div>
      </div>
    </div>
  );
}
