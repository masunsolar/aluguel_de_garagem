// Regra de preço isolada. Para mudar a lógica (ex.: por hora), edite só este arquivo.
// Modelo: 1 "dia" (06h–18h) e/ou 1 "noite" (18h–06h) para cada período em que o carro ficar.
import { UserError } from "./errors";
import { brtToDate, wallMs } from "./time";
export type PricingConfig = { dayPrice: number; nightPrice: number; dayStartHour: number; nightStartHour: number };
export const DEFAULT_PRICING: PricingConfig = { dayPrice: 30, nightPrice: 15, dayStartHour: 6, nightStartHour: 18 };

const H = 3_600_000, D = 24 * H;

export function calculatePrice(start: Date, end: Date, c: PricingConfig = DEFAULT_PRICING) {
  if (Number.isNaN(+start) || Number.isNaN(+end)) throw new UserError("Data ou horário inválido.");
  if (end <= start) throw new UserError("A saída precisa ser depois da entrada.");
  const s = wallMs(start), e = wallMs(end); // relógio de Brasília
  let days = 0, nights = 0;
  for (let d = Math.floor(s / D) * D - D; d < e; d += D) {
    const dayA = d + c.dayStartHour * H, nightA = d + c.nightStartHour * H, nightB = d + D + c.dayStartHour * H;
    if (s < nightA && e > dayA) days++;
    if (s < nightB && e > nightA) nights++;
  }
  const totalCents = Math.round((days * c.dayPrice + nights * c.nightPrice) * 100);
  return { days, nights, minutes: Math.round((+end - +start) / 60000), totalCents };
}
export const brl = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const toDate = brtToDate;
