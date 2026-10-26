"use client";
import { brl } from "@/lib/pricing";
import { brtDay, brtToDate, fmtBR } from "@/lib/time";

const hm = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
// Calendário: próximos 14 dias, com cada ocupação do dia. Bloqueios em preto, irregulares em vermelho.
export default function Agenda({ rows, onOpen }: { rows: any[]; onOpen: (id: string) => void }) {
  const active = rows.filter((r) => ["pendente", "confirmada", "em_andamento", "bloqueada", "irregular"].includes(r.status));
  const days = Array.from({ length: 28 }, (_, i) => brtDay(new Date(Date.now() + i * 86400000)));
  return (
    <section className="rounded-2xl bg-white p-4" aria-label="Calendário da garagem">
      <h2 className="mb-2 font-semibold">Calendário — próximos 28 dias</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((d) => {
          const a = +brtToDate(d, "00:00"), b = a + 86400000;
          const items = active.filter((r) => +new Date(r.start_at) < b && +new Date(r.end_at) > a);
          return (
            <div key={d} className="min-h-20 rounded-xl border border-asfalto/10 p-2">
              <div className="mb-1 text-xs font-semibold text-asfalto/60">{new Date(d + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" })}</div>
              {items.length === 0 && <div className="text-xs text-livre">livre</div>}
              {items.map((r) => (
                <button key={r.id} onClick={() => onOpen(r.id)} title={`${fmtBR(r.start_at)} → ${fmtBR(r.end_at)} • ${brl(r.total_cents)}`}
                  className={`mb-1 block w-full rounded-md px-1.5 py-1 text-left text-xs text-white ${r.status === "bloqueada" ? "bg-asfalto" : r.status === "irregular" ? "bg-ocupado" : "bg-livre"}`}>
                  {new Date(r.start_at) < new Date(a) ? "↤" : hm(r.start_at)}–{new Date(r.end_at) > new Date(b) ? "↦" : hm(r.end_at)}<br />
                  {r.status === "bloqueada" ? `Bloqueio${r.public_reason || r.notes ? `: ${r.public_reason || r.notes}` : ""}` : `${r.name ?? "?"}${r.apartment ? ` • ${r.apartment}` : ""}`}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
