"use client";
import { useEffect, useState } from "react";
import { api, fmtDT } from "@/lib/client";
import { brl } from "@/lib/pricing";
import { prepareReceipt } from "@/lib/image";

// Painel de créditos do admin: pedidos dos vizinhos para confirmar, quem tem crédito (saldo e extrato),
// lançar crédito sem reserva, anexar comprovantes e dar baixa.
type Receipt = { id: string; actor: string; mime: string; createdAt: string };
type Req = { id: string; amountCents: number; status: string; source: string; name: string; apartment: string | null; plate: string | null; phone: string | null;
  note: string | null; adminNote: string | null; createdAt: string; decidedAt: string | null; confirmedCents: number | null; receipts: Receipt[] };
type Lot = { id: string; kind: string; amountCents: number; remainingCents: number; note: string | null; createdAt: string };
type Mov = { at: string; amountCents: number; balanceCents: number; type: string; label: string; reservation: { id: string; start: string; end: string } | null };
type Person = { name: string | null; apartment: string | null; plate: string | null; balanceCents: number; receivedCents: number; lots: Lot[]; movements: Mov[] };

const inp = "mt-1 w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2";
const cents = (v: string) => Math.round(Number(String(v).replace(",", ".")) * 100) || 0;
const STATUS: Record<string, string> = { pendente: "bg-faixa/30", confirmado: "bg-livre/15 text-livre", recusado: "bg-ocupado/10 text-ocupado", cancelado: "bg-asfalto/10 text-asfalto/60" };
const who = (x: { name: string | null; apartment: string | null; plate: string | null }) => [x.name ?? "Sem nome", x.apartment && `apto ${x.apartment}`, x.plate].filter(Boolean).join(" • ");

async function uploadReceipt(requestId: string, file: File) {
  const { blob, name } = await prepareReceipt(file);
  const fd = new FormData(); fd.append("file", blob, name);
  const r = await fetch(`/api/admin/creditos/pedidos/${requestId}/comprovante`, { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Não foi possível anexar o comprovante.");
}

function Receipts({ list }: { list: Receipt[] }) {
  if (!list.length) return <span className="text-asfalto/60">Sem comprovante</span>;
  return <span className="flex flex-wrap gap-2">{list.map((c) => (
    <a key={c.id} href={`/api/admin/credit-receipts/${c.id}`} target="_blank" className="block w-20 text-center text-xs underline">
      {c.mime === "application/pdf" ? <span className="flex aspect-square items-center justify-center rounded-lg bg-concreto text-2xl">📄</span>
        : <img src={`/api/admin/credit-receipts/${c.id}`} alt="Comprovante" className="aspect-square w-full rounded-lg object-cover" />}
      {c.actor === "admin" ? "você" : "vizinho"} • {fmtDT(c.createdAt).slice(0, 5)}
    </a>))}</span>;
}

export default function Credits({ onChanged }: { onChanged: () => void }) {
  const [d, setD] = useState<{ requests: Req[]; people: Person[] } | null>(null);
  const [err, setErr] = useState(""); const [info, setInfo] = useState(""); const [busy, setBusy] = useState("");
  const [all, setAll] = useState(false); const [openP, setOpenP] = useState(""); const [amount, setAmount] = useState<Record<string, string>>({});
  const load = () => api("/api/admin/creditos").then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function run(key: string, fn: () => Promise<string>) {
    setErr(""); setInfo(""); setBusy(key);
    try { setInfo(await fn()); await load(); onChanged(); } catch (e) { setErr((e as Error).message); }
    setBusy("");
  }
  const confirmReq = (r: Req) => run(r.id, async () => {
    const v = cents(amount[r.id] ?? (r.amountCents / 100).toFixed(2));
    const x = await api(`/api/admin/creditos/pedidos/${r.id}`, "POST", { action: "confirmar", amountCents: v });
    return `Crédito de ${brl(v)} confirmado para ${r.name}.${x.usedCents ? ` ${brl(x.usedCents)} já pagaram reservas pendentes.` : ""} Saldo: ${brl(x.creditLeftCents)}.`;
  });
  const rejectReq = (r: Req) => {
    const note = prompt(`Recusar o pedido de ${brl(r.amountCents)} de ${r.name}?\n\nMotivo (o vizinho vê):`);
    if (note === null) return;
    run(r.id, async () => { await api(`/api/admin/creditos/pedidos/${r.id}`, "POST", { action: "recusar", note: note.trim() || null }); return "Pedido recusado."; });
  };
  const attach = (r: Req, file?: File) => file && run(r.id, async () => { await uploadReceipt(r.id, file); return "Comprovante anexado."; });
  const writeOff = (l: Lot) => {
    const note = prompt(`Zerar o saldo de ${brl(l.remainingCents)} deste crédito? (dinheiro devolvido ou lançado por engano)\n\nMotivo (opcional):`);
    if (note === null) return;
    run(l.id, async () => { const x = await api(`/api/admin/creditos/${l.id}/baixa`, "POST", { note: note.trim() || null }); return `Baixa de ${brl(x.removedCents)} registrada.`; });
  };

  if (!d) return <section className="rounded-2xl bg-white p-4">{err ? <p className="text-ocupado">{err}</p> : <p className="animate-pulse text-asfalto/60">Carregando créditos…</p>}</section>;
  const pending = d.requests.filter((r) => r.status === "pendente"), decided = d.requests.filter((r) => r.status !== "pendente");
  const people = d.people.filter((p) => all || p.balanceCents > 0);
  const total = d.people.reduce((t, p) => t + p.balanceCents, 0);

  return (
    <section className="space-y-4 rounded-2xl bg-white p-4" aria-label="Créditos">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="mr-auto text-xl font-bold">Créditos</h2>
        <span className="text-sm text-asfalto/70">Total em crédito (dinheiro já recebido, ainda não usado): <b className="text-livre">{brl(total)}</b></span>
      </div>
      {info && <p role="status" className="rounded-lg bg-livre/10 p-3 text-sm text-livre">{info}</p>}
      {err && <p role="alert" className="rounded-lg bg-ocupado/10 p-3 text-sm text-ocupado">{err}</p>}

      <div>
        <h3 className="font-semibold">Pedidos para confirmar {pending.length > 0 && <span className="ml-1 rounded-full bg-faixa px-2 py-0.5 text-sm">{pending.length}</span>}</h3>
        {pending.length === 0 && <p className="mt-1 text-sm text-asfalto/60">Nenhum pedido aguardando.</p>}
        <ul className="mt-2 space-y-2">{pending.map((r) => (
          <li key={r.id} className="space-y-2 rounded-xl border border-faixa bg-faixa/10 p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-2"><b className="text-base">{who(r)}</b><span className="text-asfalto/60">{fmtDT(r.createdAt)}{r.phone ? ` • WhatsApp ${r.phone}` : ""}</span>
              <span className="ml-auto text-lg font-bold">{brl(r.amountCents)}</span></div>
            {r.note && <p>Recado: {r.note}</p>}
            <div className="flex flex-wrap items-center gap-3"><Receipts list={r.receipts} />
              <label className="cursor-pointer underline">Anexar comprovante<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { attach(r, e.target.files?.[0]); e.target.value = ""; }} /></label></div>
            <div className="flex flex-wrap items-end gap-2">
              <label>Valor que você recebeu (R$)<input type="number" step="0.01" min={0.01} className={inp + " max-w-36"} value={amount[r.id] ?? (r.amountCents / 100).toFixed(2)} onChange={(e) => setAmount({ ...amount, [r.id]: e.target.value })} /></label>
              <button disabled={!!busy || cents(amount[r.id] ?? String(r.amountCents / 100)) <= 0} onClick={() => confirmReq(r)} className="rounded-lg bg-livre px-3 py-2 font-semibold text-white disabled:opacity-50">{busy === r.id ? "Salvando…" : "Confirmar crédito"}</button>
              <button disabled={!!busy} onClick={() => rejectReq(r)} className="rounded-lg border border-ocupado px-3 py-2 text-ocupado">Recusar</button>
            </div>
          </li>))}</ul>
      </div>

      <div>
        <div className="flex flex-wrap items-center gap-3"><h3 className="mr-auto font-semibold">Quem tem crédito</h3>
          <label className="text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> mostrar também quem já usou tudo</label></div>
        {people.length === 0 && <p className="mt-1 text-sm text-asfalto/60">{all ? "Ninguém teve crédito ainda." : "Ninguém com saldo agora."}</p>}
        <ul className="mt-2 divide-y divide-asfalto/10">{people.map((p) => {
          const k = who(p);
          return (
            <li key={k} className="py-2">
              <button onClick={() => setOpenP(openP === k ? "" : k)} className="flex w-full flex-wrap items-baseline gap-2 text-left">
                <span className="mr-auto font-medium">{k}</span>
                <span className="text-xs text-asfalto/60">recebido no total {brl(p.receivedCents)}</span>
                <b className={p.balanceCents > 0 ? "text-livre" : "text-asfalto/60"}>{brl(p.balanceCents)}</b><span aria-hidden>{openP === k ? "▴" : "▾"}</span>
              </button>
              {openP === k && <div className="mt-2 space-y-2 rounded-xl bg-concreto p-3 text-sm">
                {p.lots.length > 0 && <ul className="space-y-1">{p.lots.map((l) => (
                  <li key={l.id} className="flex flex-wrap gap-2"><span className="mr-auto">{fmtDT(l.createdAt).slice(0, 10)} • {l.kind === "deposito" ? "adicionado pelo vizinho" : l.kind === "manual" ? "lançado por você" : "sobra de pagamento"} de {brl(l.amountCents)}{l.note ? ` • ${l.note}` : ""} → saldo <b>{brl(l.remainingCents)}</b></span>
                    <button disabled={!!busy} onClick={() => writeOff(l)} className="text-xs text-ocupado underline">dar baixa</button></li>))}</ul>}
                <table className="w-full"><tbody>{[...p.movements].reverse().map((m, i) => (
                  <tr key={i} className="border-t border-asfalto/10 align-top">
                    <td className="py-1 pr-2 text-asfalto/60">{fmtDT(m.at).slice(0, 10)}</td>
                    <td className="py-1 pr-2">{m.label}{m.reservation && <span className="block text-xs text-asfalto/60">Reserva {fmtDT(m.reservation.start)} → {fmtDT(m.reservation.end)}</span>}</td>
                    <td className={`py-1 pr-2 whitespace-nowrap text-right font-semibold ${m.amountCents >= 0 ? "text-livre" : ""}`}>{m.amountCents >= 0 ? "+" : "−"} {brl(Math.abs(m.amountCents))}</td>
                    <td className="whitespace-nowrap py-1 text-right text-asfalto/60">{brl(m.balanceCents)}</td></tr>))}</tbody></table>
              </div>}
            </li>);
        })}</ul>
      </div>

      <NewCredit people={d.people} busy={!!busy} onSubmit={(body, file) => run("novo", async () => {
        const x = await api("/api/admin/creditos", "POST", body);
        if (file) await uploadReceipt(x.requestId, file);
        return `Crédito lançado.${x.usedCents ? ` ${brl(x.usedCents)} já pagaram reservas pendentes.` : ""} Saldo da pessoa: ${brl(x.creditLeftCents)}.`;
      })} />

      {decided.length > 0 && <details className="text-sm">
        <summary className="cursor-pointer font-semibold">Pedidos já analisados ({decided.length} mais recentes)</summary>
        <ul className="mt-2 space-y-2">{decided.map((r) => (
          <li key={r.id} className="space-y-1 rounded-xl bg-concreto p-3">
            <div className="flex flex-wrap items-baseline gap-2"><span className="font-medium">{who(r)}</span>
              <span className="text-asfalto/60">{fmtDT(r.createdAt)}{r.source === "admin" ? " • lançado por você" : ""}</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 ${STATUS[r.status] ?? ""}`}>{r.status}</span>
              <b>{brl(r.confirmedCents ?? r.amountCents)}</b></div>
            {r.confirmedCents !== null && r.confirmedCents !== r.amountCents && <p className="text-asfalto/70">Informado: {brl(r.amountCents)}</p>}
            {(r.note || r.adminNote) && <p className="text-asfalto/70">{[r.note && `Recado: ${r.note}`, r.adminNote && `Sua obs.: ${r.adminNote}`].filter(Boolean).join(" • ")}</p>}
            <div className="flex flex-wrap items-center gap-3"><Receipts list={r.receipts} />
              <label className="cursor-pointer underline">Anexar comprovante<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { attach(r, e.target.files?.[0]); e.target.value = ""; }} /></label></div>
          </li>))}</ul>
      </details>}
    </section>
  );
}

function NewCredit({ people, busy, onSubmit }: { people: Person[]; busy: boolean; onSubmit: (body: any, file: File | null) => Promise<void> }) {
  const empty = { name: "", apartment: "", plate: "", value: "", note: "" };
  const [f, setF] = useState(empty); const [file, setFile] = useState<File | null>(null); const [open, setOpen] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <button onClick={() => setOpen(true)} className="rounded-lg border border-asfalto/30 px-3 py-2 text-sm">+ Lançar crédito para uma pessoa</button>;
  return (
    <form className="space-y-2 rounded-xl border border-asfalto/15 p-3 text-sm" onSubmit={async (e) => {
      e.preventDefault();
      await onSubmit({ name: f.name, apartment: f.apartment || null, plate: f.plate || null, amountCents: cents(f.value), note: f.note || null }, file);
      setF(empty); setFile(null); setOpen(false);
    }}>
      <h3 className="font-semibold">Lançar crédito (ex.: PIX recebido sem pedido)</h3>
      {people.length > 0 && <label className="block">Pessoa que já teve crédito
        <select className={inp} value="" onChange={(e) => { const p = people[Number(e.target.value)]; if (p) setF({ ...f, name: p.name ?? "", apartment: p.apartment ?? "", plate: p.plate ?? "" }); }}>
          <option value="">— escolher (preenche os dados) —</option>
          {people.map((p, i) => <option key={i} value={i}>{who(p)}</option>)}
        </select></label>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="col-span-2">Nome<input className={inp} value={f.name} onChange={set("name")} required /></label>
        <label>Apartamento<input className={inp} value={f.apartment} onChange={set("apartment")} /></label>
        <label>Placa<input className={inp} value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} maxLength={8} /></label>
        <label>Valor (R$)<input type="number" step="0.01" min={0.01} className={inp} value={f.value} onChange={set("value")} required /></label>
        <label className="col-span-2 sm:col-span-3">Observação<input className={inp} maxLength={300} value={f.note} onChange={set("note")} /></label>
      </div>
      <p className="text-xs text-asfalto/60">Precisa do nome e do apartamento ou da placa (é assim que o crédito acha as reservas da pessoa).</p>
      <label className="block">Comprovante (opcional)<input type="file" accept="image/*,application/pdf" className="mt-1 block" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      <div className="flex gap-2">
        <button disabled={busy || cents(f.value) <= 0 || !f.name || !(f.apartment || f.plate)} className="rounded-lg bg-livre px-3 py-2 font-semibold text-white disabled:opacity-50">Lançar crédito</button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2">Cancelar</button>
      </div>
    </form>
  );
}
