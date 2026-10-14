// Regra de preço isolada. Para mudar a lógica (ex.: por hora), edite só este arquivo.
// Modelo: 1 "dia" (06h–18h) e/ou 1 "noite" (18h–06h) para cada período em que o carro ficar.
// Check-out: quem PERNOITOU e sai até `checkoutTime` (ex.: 10:30) não paga o "dia" da manhã da saída.
// O dia continua começando em `dayStartHour`; a tolerância vale só para a saída.
import { UserError } from "./errors";
import { brtToDate, wallMs } from "./time";
export type PricingConfig = { dayPrice: number; nightPrice: number; dayStartHour: number; nightStartHour: number; checkoutTime: string };
export const DEFAULT_PRICING: PricingConfig = { dayPrice: 30, nightPrice: 15, dayStartHour: 6, nightStartHour: 18, checkoutTime: "10:30" };

/** Um período contabilizado. start/end são o horário de Brasília ("YYYY-MM-DDTHH:mm"), já recortados pela reserva. */
export type PricePeriod = { kind: "dia" | "noite"; start: string; end: string; cents: number; waived?: boolean };
/** Detalhamento gravado junto com a reserva: mostra exatamente como o valor foi calculado naquele momento. */
export type PriceBreakdown = { periods: PricePeriod[]; totalCents: number; checkoutTime: string };

const H = 3_600_000, M = 60_000, D = 24 * H;
const hmToMs = (hm: string) => { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hm ?? ""); return m ? +m[1] * H + +m[2] * M : null; };
const wallStr = (w: number) => new Date(w).toISOString().slice(0, 16);

/** Completa uma configuração antiga (gravada antes de existir checkoutTime) com os valores padrão. */
export const withDefaults = (c: Partial<PricingConfig> | null | undefined): PricingConfig => ({ ...DEFAULT_PRICING, ...(c ?? {}) });

export function calculatePrice(start: Date, end: Date, config: Partial<PricingConfig> = DEFAULT_PRICING) {
  const c = withDefaults(config);
  if (Number.isNaN(+start) || Number.isNaN(+end)) throw new UserError("Data ou horário inválido.");
  if (end <= start) throw new UserError("A saída precisa ser depois da entrada.");
  const s = wallMs(start), e = wallMs(end); // relógio de Brasília
  const periods: PricePeriod[] = [];
  const push = (kind: "dia" | "noite", a: number, b: number) =>
    periods.push({ kind, start: wallStr(Math.max(s, a)), end: wallStr(Math.min(e, b)), cents: Math.round((kind === "dia" ? c.dayPrice : c.nightPrice) * 100) });
  for (let d = Math.floor(s / D) * D - D; d < e; d += D) {
    const dayA = d + c.dayStartHour * H, nightA = d + c.nightStartHour * H, nightB = d + D + c.dayStartHour * H;
    if (s < nightA && e > dayA) push("dia", dayA, nightA);
    if (s < nightB && e > nightA) push("noite", nightA, nightB);
  }

  // Tolerância de check-out: o último período é a manhã do dia da saída, a pessoa já estava na vaga
  // antes do dia começar (pernoitou) e saiu até o horário de check-out => essa manhã não é cobrada.
  const checkout = hmToMs(c.checkoutTime);
  const last = periods[periods.length - 1];
  if (checkout !== null && checkout > c.dayStartHour * H && last?.kind === "dia" && periods.length > 1) {
    const endDay = Math.floor(e / D) * D, dayA = endDay + c.dayStartHour * H;
    if (s < dayA && e <= endDay + checkout) { last.cents = 0; last.waived = true; }
  }

  const charged = periods.filter((p) => !p.waived);
  const totalCents = charged.reduce((t, p) => t + p.cents, 0);
  return {
    days: charged.filter((p) => p.kind === "dia").length,
    nights: charged.filter((p) => p.kind === "noite").length,
    minutes: Math.round((+end - +start) / 60000),
    totalCents,
    breakdown: { periods, totalCents, checkoutTime: c.checkoutTime } as PriceBreakdown,
  };
}

/** "2 noites e 1 dia" */
export function summarize(days: number, nights: number) {
  const p = [nights && `${nights} ${nights === 1 ? "noite" : "noites"}`, days && `${days} ${days === 1 ? "dia" : "dias"}`].filter(Boolean);
  return p.length ? p.join(" e ") : "nenhum período";
}
export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const toDate = brtToDate;
