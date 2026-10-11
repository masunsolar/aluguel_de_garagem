// Estratégia de datas: o banco guarda INSTANTES (timestamptz). Todo horário digitado/exibido é de
// America/Sao_Paulo, convertido via Intl (não depende do fuso do navegador nem do servidor, e
// continuaria certo se o Brasil voltasse a ter horário de verão).
export const TZ = "America/Sao_Paulo";
const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** "Relógio de parede" de Brasília em ms (como se fosse UTC) para um instante. */
export function wallMs(d: Date | number): number {
  const p: Record<string, string> = {};
  for (const x of dtf.formatToParts(new Date(d))) p[x.type] = x.value;
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
/** "2026-10-10" + "18:00" (horário de Brasília) -> instante. Datas impossíveis viram Invalid Date. */
export function brtToDate(date: string, time: string): Date {
  const w = Date.parse(`${date}T${time}:00Z`);
  // V8 aceita "30/02" e rola para março: só vale se a data fizer o caminho de volta idêntica
  if (Number.isNaN(w) || new Date(w).toISOString().slice(0, 10) !== date) return new Date(NaN);
  let t = w - (wallMs(w) - w);
  t = w - (wallMs(t) - t);
  return new Date(t);
}
export const brtDay = (d: Date) => new Date(wallMs(d)).toISOString().slice(0, 10);
export const brtInput = (d: Date) => new Date(wallMs(d)).toISOString().slice(0, 16); // valor de <input datetime-local>
export const fmtBR = (d: Date | string) => new Date(d).toLocaleString("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "short" });
