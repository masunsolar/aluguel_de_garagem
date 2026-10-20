// Regra de preço isolada. Para mudar a lógica (ex.: por hora), edite só este arquivo.
// Modelo: 1 "dia" (06h–18h) e/ou 1 "noite" (18h–06h) para cada período em que o carro ficar.
// Check-out: quem PERNOITOU e sai até `checkoutTime` (ex.: 10:30) não paga o "dia" da manhã da saída.
// O dia continua começando em `dayStartHour`; a tolerância vale só para a saída.
// Pacotes (opcionais, null = desligado): o sistema monta a combinação MAIS BARATA para o vizinho:
//  - Diária completa: um "dia" + a "noite" seguinte (ex.: 09h até o check-out do dia seguinte)
//  - Fim de semana: da noite de sexta até o check-out de segunda (noite sex, sáb, noite sáb, dom, noite dom)
//  - Semana: 7 dias corridos (14 períodos seguidos)
import { UserError } from "./errors";
import { brtToDate, wallMs } from "./time";
export type PricingConfig = {
  dayPrice: number; nightPrice: number; dayStartHour: number; nightStartHour: number; checkoutTime: string;
  fullDayPrice: number | null; weekendPrice: number | null; weekPrice: number | null; // pacotes (null = desligado)
};
export const DEFAULT_PRICING: PricingConfig = { dayPrice: 30, nightPrice: 15, dayStartHour: 6, nightStartHour: 18, checkoutTime: "10:30", fullDayPrice: null, weekendPrice: null, weekPrice: null };

/** Um período contabilizado. start/end são o horário de Brasília ("YYYY-MM-DDTHH:mm"), já recortados pela reserva. */
export type PricePeriod = { kind: "dia" | "noite"; start: string; end: string; cents: number; waived?: boolean; pkg?: number };
export type PackageKind = "diaria" | "fimdesemana" | "semana";
/** Um pacote aplicado: cobre os períodos marcados com `pkg` = índice dele. fullCents = quanto custariam avulsos. */
export type PricePackage = { kind: PackageKind; start: string; end: string; cents: number; fullCents: number };
export const PACKAGE_LABEL: Record<PackageKind, string> = { diaria: "Diária completa", fimdesemana: "Fim de semana", semana: "Semana" };
/** Detalhamento gravado junto com a reserva: mostra exatamente como o valor foi calculado naquele momento. */
export type PriceBreakdown = { periods: PricePeriod[]; totalCents: number; checkoutTime: string; packages?: PricePackage[] };

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
  const starts: number[] = []; // início "cheio" de cada período (sem recorte), para saber o dia da semana
  const push = (kind: "dia" | "noite", a: number, b: number) =>
    starts.push(a) && periods.push({ kind, start: wallStr(Math.max(s, a)), end: wallStr(Math.min(e, b)), cents: Math.round((kind === "dia" ? c.dayPrice : c.nightPrice) * 100) });
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

  const { totalCents, packages } = applyPackages(periods, starts, c);
  const charged = periods.filter((p) => !p.waived);
  return {
    days: charged.filter((p) => p.kind === "dia").length,
    nights: charged.filter((p) => p.kind === "noite").length,
    minutes: Math.round((+end - +start) / 60000),
    totalCents,
    breakdown: { periods, totalCents, checkoutTime: c.checkoutTime, ...(packages.length ? { packages } : {}) } as PriceBreakdown,
  };
}

const cents = (v: number | null | undefined) => (typeof v === "number" && v >= 0 ? Math.round(v * 100) : null);

/**
 * Escolhe a combinação mais barata de avulsos e pacotes (programação dinâmica sobre a sequência de períodos:
 * best[i] = menor custo para cobrir do período i até o fim). Marca em cada período o pacote que o cobriu.
 */
function applyPackages(periods: PricePeriod[], starts: number[], c: PricingConfig) {
  const n = periods.length, price = (p: PricePeriod) => (p.waived ? 0 : p.cents);
  const fullDay = cents(c.fullDayPrice), weekend = cents(c.weekendPrice), week = cents(c.weekPrice);
  // fim de semana: noite de sexta, sábado e domingo (dia e noite). Chave = a sexta-feira daquele fim de semana.
  const weekendKey = (i: number) => {
    const day = Math.floor(starts[i] / D) * D, wd = new Date(day).getUTCDay();
    if (wd === 5 && periods[i].kind === "noite") return day;
    return wd === 6 ? day - D : wd === 0 ? day - 2 * D : null;
  };
  type Opt = { take: number; cost: number; kind?: PackageKind };
  const best: number[] = Array(n + 1).fill(0), pick: Opt[] = Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const opts: Opt[] = [{ take: 1, cost: price(periods[i]) }];
    if (fullDay !== null && periods[i].kind === "dia" && periods[i + 1]?.kind === "noite") opts.push({ take: 2, cost: fullDay, kind: "diaria" });
    const wk = weekend !== null ? weekendKey(i) : null;
    if (wk !== null) { let j = i; while (j < n && weekendKey(j) === wk) j++; opts.push({ take: j - i, cost: weekend!, kind: "fimdesemana" }); }
    if (week !== null) opts.push({ take: Math.min(14, n - i), cost: week, kind: "semana" });
    let b = opts[0];
    for (const o of opts) if (o.cost + best[i + o.take] < b.cost + best[i + b.take]) b = o; // empate: fica o avulso
    best[i] = b.cost + best[i + b.take]; pick[i] = b;
  }
  const packages: PricePackage[] = [];
  for (let i = 0; i < n; i += pick[i].take) {
    const o = pick[i]; if (!o.kind) continue;
    const covered = periods.slice(i, i + o.take);
    covered.forEach((p) => (p.pkg = packages.length));
    packages.push({ kind: o.kind, start: covered[0].start, end: covered[covered.length - 1].end, cents: o.cost, fullCents: covered.reduce((t, p) => t + price(p), 0) });
  }
  return { totalCents: best[0], packages };
}

/** "2 noites e 1 dia" */
export function summarize(days: number, nights: number) {
  const p = [nights && `${nights} ${nights === 1 ? "noite" : "noites"}`, days && `${days} ${days === 1 ? "dia" : "dias"}`].filter(Boolean);
  return p.length ? p.join(" e ") : "nenhum período";
}
export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const toDate = brtToDate;
