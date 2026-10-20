// Opções de horário do formulário de reserva. O preço é por PERÍODO (dia/noite), não por minuto,
// então não faz sentido o vizinho escolher 18:07: o seletor anda de N em N minutos (configurável no painel).
import { brtDay, wallMs } from "./time";

export const TIME_STEPS = [5, 10, 30] as const;
export type TimeStep = (typeof TIME_STEPS)[number];
export const DEFAULT_TIME_STEP: TimeStep = 30;
export const isTimeStep = (n: unknown): n is TimeStep => TIME_STEPS.includes(n as TimeStep);

const pad = (n: number) => String(n).padStart(2, "0");
export const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/**
 * Horários de 00:00 a 23:59 de `step` em `step` minutos. `keep` entra na lista mesmo fora do passo
 * (ex.: check-out 10:45 com passo de 30, ou um horário salvo antes de o passo mudar) para o select nunca
 * ficar com um valor que não existe entre as opções.
 */
export function timeOptions(step: number, keep: string[] = []): string[] {
  const s = isTimeStep(step) ? step : DEFAULT_TIME_STEP;
  const set = new Set<string>();
  for (let m = 0; m < 24 * 60; m += s) set.add(hhmm(m));
  for (const k of keep) if (/^([01]\d|2[0-3]):[0-5]\d$/.test(k)) set.add(k);
  return [...set].sort();
}

/** Próximo horário "redondo" (no passo) a partir de agora, no relógio de Brasília. */
export function nextSlot(now: Date, step: number): { date: string; time: string } {
  const s = (isTimeStep(step) ? step : DEFAULT_TIME_STEP) * 60_000;
  const w = Math.ceil((wallMs(now) + 1) / s) * s; // +1 ms: "agora" exato já passou
  const iso = new Date(w).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

export type Preset = { startDate: string; startTime: string; endDate: string; endTime: string; late: boolean };
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Botões de atalho, sempre com os horários configurados no painel:
 *  - "dia":      início do dia (dayStartHour) até o check-out do dia seguinte → diária completa (dia + noite)
 *  - "pernoite": início da noite até o check-out do dia seguinte → 1 noite (a manhã é isenta pela tolerância)
 * Se a data é hoje e o início configurado já passou, a entrada vai para o próximo horário redondo
 * (o servidor não aceita entrada no passado) e `late` = true para a tela avisar. null = período já acabou.
 */
export function preset(kind: "dia" | "pernoite", day: string, p: { dayStartHour: number; nightStartHour: number; checkoutTime: string }, step: number, now = new Date()): Preset | null {
  const dayStart = hhmm(Math.round(p.dayStartHour * 60)), nightStart = hhmm(Math.round(p.nightStartHour * 60));
  const r = kind === "dia"
    ? { startDate: day, startTime: dayStart, endDate: nextDay(day), endTime: p.checkoutTime }
    : { startDate: day, startTime: nightStart, endDate: nextDay(day), endTime: p.checkoutTime };
  let late = false;
  if (day === brtDay(now)) {
    const n = nextSlot(now, step);
    if (`${n.date}T${n.time}` > `${r.startDate}T${r.startTime}`) { r.startDate = n.date; r.startTime = n.time; late = true; }
  }
  return `${r.startDate}T${r.startTime}` < `${r.endDate}T${r.endTime}` ? { ...r, late } : null;
}
