"use client";
import { useEffect, useState } from "react";
import { api, fmtDT } from "@/lib/client";

const input = "mt-1 block w-28 rounded-lg border border-asfalto/20 bg-white px-3 py-2";
export default function Settings() {
  const [s, setS] = useState<any>(null); const [msg, setMsg] = useState("");
  useEffect(() => { api("/api/admin/settings").then(setS); }, []);
  if (!s) return null;
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, pricing: { ...s.pricing, [k]: Number(e.target.value) } });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api("/api/admin/settings", "PUT", s); setMsg("Configurações salvas."); } catch (x) { setMsg((x as Error).message); }
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4">
      <label>Antecedência máx. (dias)<input type="number" min={1} max={60} className={input} value={s.maximumReservationAdvanceDays} onChange={(e) => setS({ ...s, maximumReservationAdvanceDays: Number(e.target.value) })} /></label>
      <label className="w-full">Nome da garagem<input className="mt-1 block w-full max-w-sm rounded-lg border border-asfalto/20 px-3 py-2" value={s.garageName} onChange={(e) => setS({ ...s, garageName: e.target.value })} /></label>
      {([["dayPrice", "Dia (R$)"], ["nightPrice", "Noite (R$)"], ["dayStartHour", "Dia começa (h)"], ["nightStartHour", "Noite começa (h)"]] as const).map(([k, l]) => (
        <label key={k}>{l}<input type="number" step="0.01" className={input} value={s.pricing[k]} onChange={num(k)} /></label>
      ))}
      <button className="rounded-lg bg-asfalto px-4 py-2.5 text-white">Salvar</button>
      {msg && <span role="status">{msg}</span>}
      {s.history?.length > 0 && <details className="w-full text-sm"><summary className="cursor-pointer">Histórico de alterações</summary><ul className="mt-1 space-y-1">{s.history.map((h: any, i: number) => <li key={i}>{fmtDT(h.created_at)} — {h.details.chave === "pricing" ? "preços" : "nome"}: {JSON.stringify(h.details.de)} → {JSON.stringify(h.details.para)}</li>)}</ul></details>}
    </form>
  );
}
