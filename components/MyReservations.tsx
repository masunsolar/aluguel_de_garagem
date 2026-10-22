"use client";
import { useEffect, useState } from "react";
import { brl } from "@/lib/pricing";
import PixBox from "./PixBox";
import PriceBreakdown from "./PriceBreakdown";
import { prepareReceipt } from "@/lib/image";
import type { PixConfig } from "@/lib/pix";

const LABEL: Record<string, string> = { pendente: "Pendente", confirmada: "Confirmada", em_andamento: "Em andamento", finalizada: "Finalizada", cancelada: "Cancelada", em_analise: "Em análise" };
const fmt = (s: string) => new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default function MyReservations() {
  const [list, setList] = useState<any[] | null>(null);
  const [code, setCode] = useState(""); const [err, setErr] = useState("");
  const [pix, setPix] = useState<PixConfig | null>(null);
  const [credit, setCredit] = useState(0); // saldo de crédito de quem usa este aparelho (pagou a mais antes)
  const load = () => {
    fetch("/api/minhas-reservas/credito").then((r) => r.json()).then((c) => setCredit(Number(c.creditCents) || 0)).catch(() => {});
    return fetch("/api/minhas-reservas").then((r) => r.json()).then(setList);
  };
  useEffect(() => { load(); fetch("/api/config").then((r) => r.json()).then((c) => setPix(c.pix ?? null)).catch(() => {}); }, []);
  async function link(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    const r = await fetch("/api/minhas-reservas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    if (r.ok) { setCode(""); load(); } else setErr((await r.json()).error);
  }
  const [sending, setSending] = useState("");
  async function sendReceipt(id: string, file?: File) {
    if (!file) return; setErr(""); setSending(id);
    try {
      const { blob, name } = await prepareReceipt(file);
      const fd = new FormData(); fd.append("file", blob, name);
      const r = await fetch(`/api/minhas-reservas/${id}/comprovante`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Não foi possível enviar o comprovante.");
      load();
    } catch (e) { setErr((e as Error).message); }
    setSending("");
  }
  async function cancel(id: string) {
    if (!confirm("Cancelar esta reserva?")) return;
    const r = await fetch(`/api/minhas-reservas/${id}`, { method: "DELETE" });
    if (!r.ok) setErr((await r.json()).error); else { setErr(""); load(); }
  }
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold">Minhas reservas</h2>
      {credit > 0 && <p className="mt-2 rounded-xl bg-livre/10 p-3 text-sm">💰 Você tem <b>{brl(credit)}</b> de crédito. Ele é descontado automaticamente das suas próximas reservas.</p>}
      {list?.length === 0 && <p className="mt-2 text-asfalto/60">Você ainda não tem reservas neste aparelho.</p>}
      <ul className="mt-2 space-y-2">
        {list?.map((r) => (
          <li key={r.shortId} className="rounded-xl bg-white p-3">
           <div className="flex items-center justify-between">
            <div><div>{fmt(r.start)} → {fmt(r.end)}</div><div className="text-sm text-asfalto/60">#{r.shortId} • {LABEL[r.status] ?? r.status}</div></div>
            <div className="text-right"><b>{brl(r.totalCents)}</b>{r.feeCents > 0 && <span className="block text-xs text-ocupado">inclui {brl(r.feeCents)} de taxa por estacionar sem agendar</span>}{["pendente", "confirmada"].includes(r.status) && new Date(r.start) > new Date() && <button onClick={() => cancel(r.id)} className="block text-sm text-ocupado underline">Cancelar</button>}</div>
           </div>
           {r.status !== "cancelada" && (
             <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
               <span className={`rounded-full px-2.5 py-0.5 ${r.paymentStatus === "pago" ? "bg-livre/15 text-livre" : "bg-faixa/30"}`}>
                 {r.paymentStatus === "pago" ? (r.paidWithCredit ? "Pago com crédito" : "Pagamento confirmado") : r.receiptCount > 0 ? "Comprovante enviado — aguardando confirmação" : r.creditCents > 0 ? `Falta pagar ${brl(r.totalCents - r.creditCents)}` : "Pagamento pendente"}</span>
               {r.creditCents > 0 && r.paymentStatus !== "pago" && <span className="text-asfalto/70">{brl(r.creditCents)} já pago/abatido do seu crédito</span>}
               {r.paymentStatus !== "pago" && r.receiptCount < 3 && (
                 <label className="cursor-pointer underline">{sending === r.id ? "Enviando…" : r.receiptCount > 0 ? "Enviar outro comprovante" : "Enviar comprovante"}
                   <input type="file" accept="image/*,application/pdf" hidden disabled={!!sending} onChange={(e) => { sendReceipt(r.id, e.target.files?.[0]); e.target.value = ""; }} /></label>)}
             </div>
           )}
           {r.breakdown && <details className="mt-2 text-sm"><summary className="cursor-pointer underline">Ver o que foi cobrado</summary><PriceBreakdown breakdown={r.breakdown} chargedCents={r.totalCents - (r.feeCents ?? 0)} className="mt-1" />{r.feeCents > 0 && <p className="mt-1">+ Taxa por estacionar sem agendar: <b>{brl(r.feeCents)}</b></p>}</details>}
           {["pendente", "confirmada", "em_andamento", "finalizada"].includes(r.status) && r.paymentStatus !== "pago" && <details className="mt-2 text-sm"><summary className="cursor-pointer underline">Pagar via PIX</summary><PixBox pix={pix} totalCents={r.totalCents - (r.creditCents ?? 0)} /></details>}
          </li>
        ))}
      </ul>
      <form onSubmit={link} className="mt-3 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código de acompanhamento" className="min-w-0 flex-1 rounded-lg border border-asfalto/20 bg-white px-3 py-2" />
        <button className="rounded-lg border border-asfalto/20 px-3 py-2">Adicionar</button>
      </form>
      {err && <p role="alert" className="mt-1 text-ocupado">{err}</p>}
    </section>
  );
}
