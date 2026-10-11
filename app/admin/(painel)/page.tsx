"use client";
import { useCallback, useEffect, useState } from "react";
import Editor, { type Mode } from "@/components/admin/Editor";
import Settings from "@/components/admin/Settings";
import Agenda from "@/components/admin/Agenda";
import { api, fmtDT } from "@/lib/client";
import { brl } from "@/lib/pricing";
import { effectiveStatus } from "@/lib/status";

const BADGE: Record<string, string> = { confirmada: "bg-livre/15 text-livre", em_andamento: "bg-livre/15 text-livre", pendente: "bg-faixa/30", irregular: "bg-ocupado/15 text-ocupado", cancelada: "bg-asfalto/10 text-asfalto/60", finalizada: "bg-asfalto/10", bloqueada: "bg-asfalto text-white" };
const sel = "rounded-lg border border-asfalto/20 bg-white px-3 py-2";

export default function Painel() {
  const [rows, setRows] = useState<any[] | null>(null); const [loadErr, setLoadErr] = useState("");
  const [mode, setMode] = useState<Mode | null>(null);
  const [view, setView] = useState("futuras"); const [q, setQ] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [cfg, setCfg] = useState(false);
  const load = useCallback(() => api("/api/admin/reservations").then((r) => { setRows(r); setLoadErr(""); }).catch((e) => setLoadErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  const now = new Date().toISOString();
  const list = (rows ?? []).filter((r) =>
    (view === "todas" || (view === "futuras" ? new Date(r.end_at).toISOString() >= now : new Date(r.end_at).toISOString() < now)) &&
    (!from || new Date(r.start_at).toISOString() >= new Date(from + "T00:00:00-03:00").toISOString()) &&
    (!to || new Date(r.start_at).toISOString() <= new Date(to + "T23:59:59-03:00").toISOString()) &&
    (!q || [r.name, r.apartment, r.plate, r.car_model].join(" ").toLowerCase().includes(q.toLowerCase())));
  const revenue = list.filter((r) => ["confirmada", "em_andamento", "finalizada"].includes(r.status)).reduce((s, r) => s + r.total_cents, 0);

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-bold">Controle da garagem</h1>
        <button onClick={() => setMode({ kind: "manual" })} className="rounded-lg bg-faixa px-4 py-2.5 font-semibold">+ Nova reserva manual</button>
        <button onClick={() => setMode({ kind: "bloqueio" })} className="rounded-lg border border-asfalto/30 px-4 py-2.5">Bloquear garagem</button>
        <button onClick={() => setCfg(!cfg)} className="rounded-lg border border-asfalto/30 px-4 py-2.5">Configurações</button>
        <button onClick={async () => { await api("/api/admin/login", "DELETE"); location.href = "/admin/login"; }} className="px-3 py-2.5 underline">Sair</button>
      </header>
      {cfg && <Settings />}
      {rows && <Agenda rows={rows} onOpen={(id) => setMode({ id })} />}

      <section className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4">
        <select className={sel} value={view} onChange={(e) => setView(e.target.value)} aria-label="Período"><option value="futuras">Futuras e atuais</option><option value="anteriores">Anteriores</option><option value="todas">Todas</option></select>
        <input className={sel} placeholder="Buscar nome, apto, placa…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="text-sm">De<input className={sel + " block"} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">Até<input className={sel + " block"} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="ml-auto text-right"><div className="text-sm text-asfalto/70">Arrecadado (filtro atual)</div><div className="text-2xl font-bold text-livre">{brl(revenue)}</div></div>
      </section>

      <section className="space-y-3">
        {loadErr && <p role="alert" className="rounded-lg bg-ocupado/10 p-3 text-ocupado">{loadErr} <button onClick={load} className="underline">Tentar de novo</button></p>}
        {rows === null && !loadErr && <p className="animate-pulse text-asfalto/60">Carregando…</p>}
        {rows && list.length === 0 && <p className="text-asfalto/60">Nada por aqui com esses filtros.</p>}
        {list.map((r) => (
          <button key={r.id} onClick={() => setMode({ id: r.id })} className="flex w-full flex-wrap items-center gap-3 rounded-2xl bg-white p-4 text-left">
            <div className="min-w-56 flex-1">
              <div className="font-semibold">{r.status === "bloqueada" ? "Horário bloqueado" : r.name ?? "Sem identificação"} {r.apartment && <span className="font-normal text-asfalto/60">• Apto {r.apartment}</span>}</div>
              <div className="text-sm text-asfalto/70">{[r.car_brand, r.car_model, r.car_color, r.plate].filter(Boolean).join(" • ")}</div>
              <div className="text-sm">{fmtDT(r.start_at)} → {fmtDT(r.end_at)}</div>
              {r.notes && <div className="text-sm italic text-asfalto/60">{r.notes}</div>}
            </div>
            {r.photo_count > 0 && <span className="text-sm text-asfalto/60">📷 {r.photo_count}</span>}
            {r.source === "admin" && <span className="text-sm text-asfalto/60">manual</span>}
            <span className="font-semibold">{brl(r.total_cents)}</span>
            <span title={effectiveStatus(r) !== r.status ? `Gravado: ${r.status}. Exibido pelo horário (automático).` : undefined} className={`rounded-full px-3 py-1 text-sm ${BADGE[effectiveStatus(r)]}`}>{effectiveStatus(r).replace("_", " ")}</span>
          </button>
        ))}
      </section>
      {mode && <Editor key={mode.id ?? mode.kind} mode={mode} onClose={() => setMode(null)} onSaved={() => { setMode(null); load(); }} onOpen={(id) => setMode({ id })} />}
    </main>
  );
}
