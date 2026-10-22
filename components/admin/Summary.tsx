"use client";
import { useState } from "react";
import { brl } from "@/lib/pricing";
import { brtDay, brtToDate, fmtBR } from "@/lib/time";

// Reservas que contam como receita (a vaga foi ou será usada). Cancelada e bloqueio não entram.
export const REVENUE = ["pendente", "confirmada", "em_andamento", "finalizada", "irregular"];
const ACTIVE = ["pendente", "confirmada", "em_andamento", "bloqueada", "irregular"];
const month = (iso: string) => brtDay(new Date(iso)).slice(0, 7); // "2026-10" no horário de Brasília
const label = (m: string) => { const t = new Date(m + "-15T12:00:00Z").toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }); return t[0].toUpperCase() + t.slice(1); };
const shift = (m: string, n: number) => { const d = new Date(m + "-15T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
const who = (r: any) => (r.status === "bloqueada" ? `Bloqueio${r.notes ? `: ${r.notes}` : ""}` : `${r.name ?? "Sem identificação"}${r.apartment ? ` • ${r.apartment}` : ""}`);
const hm = (s: string) => fmtBR(s).slice(-5);

/** Resumo do mês: a reserva entra no mês em que começa. Lucro = recebido − custo mensal da garagem. */
export function MonthSummary({ rows, monthlyCost }: { rows: any[]; monthlyCost: number }) {
  const [m, setM] = useState(() => month(new Date().toISOString()));
  const list = rows.filter((r) => REVENUE.includes(r.status) && month(r.start_at) === m);
  // crédito já abatido numa reserva ainda pendente conta como recebido
  const received = list.reduce((t, r) => t + (r.payment_status === "pago" ? r.total_cents : r.credit_cents ?? 0), 0);
  const pending = list.filter((r) => r.payment_status !== "pago").reduce((t, r) => t + r.total_cents - (r.credit_cents ?? 0), 0);
  const cost = Math.round(monthlyCost * 100);
  // ocupação: horas usadas dentro do mês / horas do mês (recorta reservas que atravessam a virada)
  const a = +brtToDate(m + "-01", "00:00"), b = +brtToDate(shift(m, 1) + "-01", "00:00");
  const used = list.reduce((t, r) => t + Math.max(0, Math.min(b, +new Date(r.end_at)) - Math.max(a, +new Date(r.start_at))), 0);
  const result = received - cost, forecast = received + pending - cost;
  const tone = (v: number) => (v >= 0 ? "text-livre" : "text-ocupado");
  return (
    <section className="rounded-2xl bg-white p-4" aria-label="Resumo do mês">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="mr-auto font-semibold">Resumo de {label(m)}</h2>
        <button onClick={() => setM(shift(m, -1))} className="rounded-lg border border-asfalto/20 px-3 py-1" aria-label="Mês anterior">‹</button>
        <button onClick={() => setM(month(new Date().toISOString()))} className="rounded-lg border border-asfalto/20 px-3 py-1 text-sm">Este mês</button>
        <button onClick={() => setM(shift(m, 1))} className="rounded-lg border border-asfalto/20 px-3 py-1" aria-label="Próximo mês">›</button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Recebido" value={brl(received)} cls="text-livre" />
        <Stat label="A receber" value={brl(pending)} />
        <Stat label="Custo da garagem" value={`− ${brl(cost)}`} cls="text-asfalto/70" />
        <Stat label="Lucro até agora" value={brl(result)} cls={tone(result)} hint="recebido − custo" />
        <Stat label="Se todos pagarem" value={brl(forecast)} cls={tone(forecast)} hint={`${list.length} reserva${list.length === 1 ? "" : "s"} • ${Math.round((used / (b - a)) * 100)}% do mês ocupado`} />
      </div>
    </section>
  );
}

function Stat({ label, value, cls = "", hint }: { label: string; value: string; cls?: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-concreto p-3">
      <div className="text-xs text-asfalto/70">{label}</div>
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      {hint && <div className="text-xs text-asfalto/60">{hint}</div>}
    </div>
  );
}

/** Hoje: quem está na vaga agora, quem entra e quem sai hoje (horário de Brasília). */
export function Today({ rows, onOpen }: { rows: any[]; onOpen: (id: string) => void }) {
  const now = Date.now(), today = brtDay(new Date());
  const act = rows.filter((r) => ACTIVE.includes(r.status));
  const nowIn = act.filter((r) => +new Date(r.start_at) <= now && +new Date(r.end_at) > now);
  const enters = act.filter((r) => brtDay(new Date(r.start_at)) === today && +new Date(r.start_at) > now);
  const leaves = act.filter((r) => brtDay(new Date(r.end_at)) === today && +new Date(r.end_at) > now);
  const Item = ({ r, t }: { r: any; t: string }) => (
    <li><button onClick={() => onOpen(r.id)} className="text-left underline-offset-2 hover:underline"><b>{t}</b> {who(r)}</button></li>
  );
  return (
    <section className="grid gap-3 rounded-2xl bg-white p-4 sm:grid-cols-3" aria-label="Hoje">
      <div>
        <h3 className="text-sm text-asfalto/70">Na vaga agora</h3>
        {nowIn.length ? <ul className="mt-1 space-y-1 text-sm">{nowIn.map((r) => <Item key={r.id} r={r} t={`até ${brtDay(new Date(r.end_at)) === today ? hm(r.end_at) : fmtBR(r.end_at)}`} />)}</ul>
          : <p className="mt-1 text-sm font-semibold text-livre">Vaga livre</p>}
      </div>
      <div>
        <h3 className="text-sm text-asfalto/70">Entram hoje</h3>
        {enters.length ? <ul className="mt-1 space-y-1 text-sm">{enters.map((r) => <Item key={r.id} r={r} t={hm(r.start_at)} />)}</ul> : <p className="mt-1 text-sm text-asfalto/50">Ninguém</p>}
      </div>
      <div>
        <h3 className="text-sm text-asfalto/70">Saem hoje</h3>
        {leaves.length ? <ul className="mt-1 space-y-1 text-sm">{leaves.map((r) => <Item key={r.id} r={r} t={hm(r.end_at)} />)}</ul> : <p className="mt-1 text-sm text-asfalto/50">Ninguém</p>}
      </div>
    </section>
  );
}
