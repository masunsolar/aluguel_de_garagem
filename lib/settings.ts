import "server-only";
import { iso, json, sql } from "./db";
import { RULES } from "./rules";
import { DEFAULT_PRICING, type PricingConfig } from "./pricing";
import { EMPTY_PIX, type PixConfig } from "./pix";

export async function getPricing(): Promise<PricingConfig> {
  const r = await sql`select value from settings where key = 'pricing'`;
  return (json(r[0]?.value) as PricingConfig) ?? DEFAULT_PRICING;
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
export async function getAdvanceDays(): Promise<number> {
  const r = await sql`select value from settings where key = 'booking'`;
  const n = Number(json(r[0]?.value)?.maximumReservationAdvanceDays);
  return Number.isInteger(n) && n >= 1 ? n : RULES.advanceDaysDefault;
}
export async function saveSettings(pricing: PricingConfig, garageName: string, maximumReservationAdvanceDays: number, pix?: PixConfig) {
  await saveSetting("booking", { maximumReservationAdvanceDays });
  await saveSetting("pricing", pricing);
  await saveSetting("garage_name", garageName);
  if (pix) await saveSetting("pix", pix);
}
export async function settingsHistory() {
  return (await sql`select details, created_at from reservation_events where action = 'configuracao_alterada' order by id desc limit 10`).map((h) => ({ details: json(h.details), created_at: iso(h.created_at) }));
}
