import "server-only";
import { iso, json, sql } from "./db";
import { RULES } from "./rules";
import { withDefaults, type PricingConfig } from "./pricing";
import { EMPTY_PIX, type PixConfig } from "./pix";

export async function getPricing(): Promise<PricingConfig> {
  const r = await sql`select value from settings where key = 'pricing'`;
  return withDefaults(json(r[0]?.value) as Partial<PricingConfig> | null); // configs antigas não têm checkoutTime
}
export async function getGarageName(): Promise<string> {
  const r = await sql`select value from settings where key = 'garage_name'`;
  const v = json(r[0]?.value); return typeof v === "string" && v ? v : "Garagem";
}
// Grava a configuração e o evento de auditoria (de → para) no MESMO comando SQL: ou os dois, ou nenhum.
async function saveSetting(key: string, value: unknown) {
  await sql`with old as (select value from settings where key = ${key}),
    upd as (insert into settings (key, value) values (${key}, ${JSON.stringify(value)}::jsonb)
            on conflict (key) do update set value = excluded.value returning value)
    insert into reservation_events (reservation_id, actor, action, details)
    select null, 'admin', 'configuracao_alterada', jsonb_build_object('chave', ${key}::text, 'de', (select value from old), 'para', upd.value)
    from upd where upd.value is distinct from (select value from old)`;
}
export async function getPix(): Promise<PixConfig> {
  const r = await sql`select value from settings where key = 'pix'`;
  const v = json(r[0]?.value);
  return v && typeof v.key === "string" ? { key: v.key, name: String(v.name ?? ""), city: String(v.city ?? "") } : EMPTY_PIX;
}
async function getBooking() {
  const r = await sql`select value from settings where key = 'booking'`;
  return (json(r[0]?.value) ?? {}) as { maximumReservationAdvanceDays?: unknown; maxUnpaidReservations?: unknown };
}
export async function getAdvanceDays(): Promise<number> {
  const n = Number((await getBooking()).maximumReservationAdvanceDays);
  return Number.isInteger(n) && n >= 1 ? n : RULES.advanceDaysDefault;
}
/** Limite de pagamentos pendentes por apartamento. null = bloqueio desligado. Config antiga (sem a chave) = padrão. */
export async function getMaxUnpaid(): Promise<number | null> {
  const b = await getBooking();
  if (!("maxUnpaidReservations" in b)) return RULES.maxUnpaidDefault;
  const n = b.maxUnpaidReservations;
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}
export async function saveSettings(pricing: PricingConfig, garageName: string, maximumReservationAdvanceDays: number, pix?: PixConfig, maxUnpaidReservations?: number | null) {
  // ausente = mantém o valor atual (quem chama sem o campo não desliga o bloqueio sem querer)
  const maxUnpaid = maxUnpaidReservations === undefined ? await getMaxUnpaid() : maxUnpaidReservations;
  await saveSetting("booking", { maximumReservationAdvanceDays, maxUnpaidReservations: maxUnpaid });
  await saveSetting("pricing", pricing);
  await saveSetting("garage_name", garageName);
  if (pix) await saveSetting("pix", pix);
}
export async function settingsHistory() {
  return (await sql`select details, created_at from reservation_events where action = 'configuracao_alterada' order by id desc limit 10`).map((h) => ({ details: json(h.details), created_at: iso(h.created_at) }));
}
