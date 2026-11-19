import { Fragment } from "react";
import { PACKAGE_LABEL, brl, summarize, type PriceBreakdown as Breakdown } from "@/lib/pricing";

// start/end chegam como horário de Brasília "YYYY-MM-DDTHH:mm": formata sem passar por Date (sem risco de fuso)
const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const hm = (s: string) => s.slice(11, 16);
const range = (a: string, b: string) => (a.slice(0, 10) === b.slice(0, 10) ? `${dm(a)} ${hm(a)} → ${hm(b)}` : `${dm(a)} ${hm(a)} → ${dm(b)} ${hm(b)}`);

/** Tabela "o que foi contabilizado". `chargedCents` = valor realmente cobrado (se diferente do cálculo, avisa). */
export default function PriceBreakdown({ breakdown, chargedCents, className = "", compact = false }: { breakdown: Breakdown | null | undefined; chargedCents?: number; className?: string; compact?: boolean }) {
  if (!breakdown?.periods?.length) return null;
  const charged = breakdown.periods.filter((p) => !p.waived);
  if (compact) return <CompactBreakdown breakdown={breakdown} className={className} />;
  const days = charged.filter((p) => p.kind === "dia").length, nights = charged.length - days;
  const adjusted = chargedCents !== undefined && chargedCents !== breakdown.totalCents;
  return (
    <div className={`text-sm ${className}`}>
      <div className="font-semibold">Contabilizado: {summarize(days, nights)}</div>
      <table className="mt-1 w-full">
        <tbody>
          {breakdown.periods.map((p, i) => {
            const pk = p.pkg !== undefined ? breakdown.packages?.[p.pkg] : undefined;
            const first = pk && breakdown.periods.findIndex((x) => x.pkg === p.pkg) === i;
            return (
              <Fragment key={i}>
                {pk && first && (
                  <tr className="border-b border-asfalto/10 font-medium">
                    <td className="pt-1.5 pr-2" colSpan={2}>{PACKAGE_LABEL[pk.kind]} <span className="font-normal text-livre">· economia de {brl(pk.fullCents - pk.cents)}</span></td>
                    <td className="pt-1.5 text-right whitespace-nowrap">{brl(pk.cents)}</td>
                  </tr>
                )}
                <tr className={`border-b border-asfalto/10 ${p.waived || pk ? "text-asfalto/50" : ""}`}>
                  <td className={`py-1 pr-2 ${pk ? "pl-3" : ""}`}>{p.kind === "dia" ? "Dia" : "Noite"}</td>
                  <td className="py-1 pr-2">{range(p.start, p.end)}</td>
                  <td className="py-1 text-right whitespace-nowrap">{p.waived ? <span title={`Saída até ${breakdown.checkoutTime}`}>grátis*</span> : pk ? "incluído" : brl(p.cents)}</td>
                </tr>
              </Fragment>
            );
          })}
          <tr className="font-semibold"><td className="pt-1" colSpan={2}>Total</td><td className="pt-1 text-right">{brl(breakdown.totalCents)}</td></tr>
        </tbody>
      </table>
      {breakdown.periods.some((p) => p.waived) && <p className="mt-1 text-xs text-asfalto/60">* Check-out até {breakdown.checkoutTime}: a manhã da saída não é cobrada para quem pernoitou.</p>}
      {adjusted && <p className="mt-1 text-xs text-asfalto/70">Valor ajustado pelo administrador para <b>{brl(chargedCents!)}</b>.</p>}
    </div>
  );
}

/** Versão enxuta (tela de reserva): só pacotes/diárias com o valor, sem listar cada dia e noite. */
function CompactBreakdown({ breakdown, className }: { breakdown: Breakdown; className: string }) {
  const loose = breakdown.periods.filter((p) => p.pkg === undefined && !p.waived);
  const rows: { label: string; note?: string; cents: number }[] = (breakdown.packages ?? []).map((pk) => ({
    label: PACKAGE_LABEL[pk.kind],
    note: pk.fullCents > pk.cents ? `economia de ${brl(pk.fullCents - pk.cents)}` : undefined,
    cents: pk.cents,
  }));
  for (const kind of ["dia", "noite"] as const) {
    const ps = loose.filter((p) => p.kind === kind);
    if (ps.length) rows.push({ label: summarize(kind === "dia" ? ps.length : 0, kind === "noite" ? ps.length : 0), cents: ps.reduce((t, p) => t + p.cents, 0) });
  }
  return (
    <div className={`text-sm ${className}`}>
      {rows.map((r, i) => (
        <div key={i} className="flex justify-between gap-2 border-b border-asfalto/10 py-1">
          <span>{r.label}{r.note && <span className="text-livre"> · {r.note}</span>}</span>
          <span className="whitespace-nowrap font-medium">{brl(r.cents)}</span>
        </div>
      ))}
    </div>
  );
}
