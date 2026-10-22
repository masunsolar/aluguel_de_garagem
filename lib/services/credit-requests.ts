import "server-only";
import { iso, q, sql, tx } from "../db";
import { UserError } from "../errors";
import type { Who } from "../identity";
import { autoApply, balanceFor, creditPeople, identifies } from "./credit";

/**
 * PEDIDOS DE CRÉDITO: o vizinho avisa "mandei R$ X" (com comprovante). Nada vira crédito até o admin confirmar.
 * Confirmar cria um lote 'deposito' em `credits` (com o valor que o admin de fato recebeu) e já abate as reservas
 * pendentes da pessoa. Recusar/cancelar não cria nada. Comprovante: vizinho (só nos próprios pedidos pendentes)
 * e admin (em qualquer pedido). Tudo fica no histórico (reservation_events, sem reserva ligada).
 */

const LOCK = q`select pg_advisory_xact_lock(727274)`; // o mesmo lock das operações de crédito
const MAX_RECEIPTS = 5;

export type NewRequest = { amountCents: number; name: string; apartment: string; plate?: string | null; phone?: string | null; note?: string | null };

export async function createRequest(i: NewRequest) {
  if (!identifies(i)) throw new UserError("Informe o nome e o apartamento.");
  const details = JSON.stringify({ valor_cents: i.amountCents });
  const r = await sql`with c as (insert into credit_requests (amount_cents, name, apartment, plate, phone, note)
      values (${i.amountCents}, ${i.name}, ${i.apartment}, ${i.plate || null}, ${i.phone || null}, ${i.note || null}) returning id)
    insert into reservation_events (reservation_id, actor, action, details)
    select null, 'vizinho', 'pedido_credito_criado', ${details}::jsonb || jsonb_build_object('pedido', c.id) from c returning details->>'pedido' as id`;
  return r[0].id as string;
}

const ids = (l: string[]) => l.filter((i) => /^[0-9a-f-]{36}$/i.test(i)).join(",");

/** Pedidos deste aparelho (cookie). Só o que o próprio vizinho informou + a decisão; nada de outras pessoas. */
export async function listMineRequests(requestIds: string[]) {
  if (!ids(requestIds)) return [];
  const rows = await sql`select r.id, r.amount_cents, r.status, r.admin_note, r.created_at, r.decided_at,
      (select count(*)::int from credit_receipts c where c.request_id = r.id) as receipt_count,
      (select amount_cents from credits c where c.request_id = r.id) as confirmed_cents
    from credit_requests r where r.id::text = any(string_to_array(${ids(requestIds)}, ',')) and r.source = 'vizinho' order by r.created_at desc`;
  return rows.map((r) => ({ id: r.id as string, amountCents: r.amount_cents as number, status: r.status as string, adminNote: r.admin_note ?? null,
    createdAt: iso(r.created_at)!, decidedAt: iso(r.decided_at), receiptCount: r.receipt_count as number, confirmedCents: r.confirmed_cents ?? null }));
}

/** O vizinho desiste de um pedido ainda pendente (a rota já confirmou que é dele). */
export async function cancelMineRequest(id: string) {
  const r = await sql`with u as (update credit_requests set status = 'cancelado', decided_at = now(), updated_at = now()
      where id = ${id} and status = 'pendente' and source = 'vizinho' returning id)
    insert into reservation_events (reservation_id, actor, action, details) select null, 'vizinho', 'pedido_credito_cancelado', jsonb_build_object('pedido', u.id) from u
    returning 1`;
  return r.length > 0;
}

/** Anexa comprovante. Vizinho: só em pedido pendente. Admin: em qualquer pedido. */
export async function addRequestReceipt(id: string, bytes: Buffer, mime: string, actor: "vizinho" | "admin") {
  const [ok] = await sql`select status, (select count(*) from credit_receipts c where c.request_id = credit_requests.id) as n
    from credit_requests where id = ${id}`;
  if (!ok) return false;
  if (actor === "vizinho" && ok.status !== "pendente") throw new UserError("Este pedido já foi analisado: não dá para enviar outro comprovante.");
  if (Number(ok.n) >= MAX_RECEIPTS) throw new UserError(`Limite de ${MAX_RECEIPTS} comprovantes por pedido.`);
  await sql`with c as (insert into credit_receipts (request_id, actor, mime, data) values (${id}, ${actor}, ${mime}, decode(${bytes.toString("base64")}, 'base64')) returning id)
    insert into reservation_events (reservation_id, actor, action, details)
    select null, ${actor}, 'pedido_credito_comprovante', jsonb_build_object('pedido', ${id}::uuid, 'comprovante', c.id) from c`;
  return true;
}
export async function getCreditReceipt(id: string) {
  const [c] = await sql`select mime, encode(data, 'base64') as b64 from credit_receipts where id = ${id}`;
  return c ? { mime: c.mime as string, bytes: Buffer.from(c.b64, "base64") } : null;
}

/**
 * Admin confirma o pedido com o valor que REALMENTE recebeu (pode ser diferente do informado). Cria o lote e,
 * na mesma transação, marca o pedido como confirmado (confirmar duas vezes não duplica: índice único + status).
 * Depois abate as reservas pendentes da pessoa.
 */
export async function confirmRequest(id: string, amountCents: number, adminNote?: string | null) {
  const [cur] = await sql`select status, name, apartment, plate from credit_requests where id = ${id}`;
  if (!cur) return null;
  if (cur.status !== "pendente") throw new UserError("Este pedido já foi analisado.");
  const details = JSON.stringify({ pedido: id, valor_cents: amountCents, ...(adminNote && { obs: adminNote }) });
  const [, rows] = await tx([LOCK, q`
    with u as (update credit_requests set status = 'confirmado', admin_note = ${adminNote ?? null}, decided_at = now(), updated_at = now()
        where id = ${id}::uuid and status = 'pendente' returning id, name, apartment, plate, note),
      c as (insert into credits (amount_cents, kind, request_id, name, apartment, plate, note)
        select ${amountCents}, 'deposito', u.id, u.name, u.apartment, u.plate, u.note from u returning id),
      e as (insert into reservation_events (reservation_id, actor, action, details) select null, 'admin', 'pedido_credito_confirmado', ${details}::jsonb from c returning 1)
    select count(*)::int as n from c`]);
  if (!rows[0]?.n) throw new UserError("Este pedido já foi analisado.");
  const who = cur as Who;
  const used = await autoApply(who, "admin");
  return { usedCents: used, creditLeftCents: await balanceFor(who) };
}

export async function rejectRequest(id: string, adminNote?: string | null) {
  const r = await sql`with u as (update credit_requests set status = 'recusado', admin_note = ${adminNote ?? null}, decided_at = now(), updated_at = now()
      where id = ${id} and status = 'pendente' returning id)
    insert into reservation_events (reservation_id, actor, action, details)
    select null, 'admin', 'pedido_credito_recusado', jsonb_build_object('pedido', u.id, 'obs', ${adminNote ?? null}::text) from u returning 1`;
  if (r.length) return true;
  const [x] = await sql`select 1 from credit_requests where id = ${id}`;
  if (!x) return null;
  throw new UserError("Este pedido já foi analisado.");
}

/** Painel de créditos: pedidos (pendentes primeiro, depois os 40 mais recentes) e pessoas com saldo/extrato. */
export async function creditOverview() {
  const rows = await sql`select r.*, (select amount_cents from credits c where c.request_id = r.id) as confirmed_cents
    from credit_requests r where r.status = 'pendente'
       or r.id in (select id from credit_requests where status <> 'pendente' order by coalesce(decided_at, created_at) desc limit 40)
    order by (r.status = 'pendente') desc, coalesce(r.decided_at, r.created_at) desc`;
  const rec = rows.length ? await sql`select id, request_id, actor, mime, created_at from credit_receipts
    where request_id::text = any(string_to_array(${rows.map((r) => r.id).join(",")}, ',')) order by created_at` : [];
  const requests = rows.map((r) => ({ id: r.id as string, amountCents: r.amount_cents as number, status: r.status as string, source: r.source as string,
    name: r.name as string, apartment: r.apartment ?? null, plate: r.plate ?? null, phone: r.phone ?? null, note: r.note ?? null, adminNote: r.admin_note ?? null,
    createdAt: iso(r.created_at)!, decidedAt: iso(r.decided_at), confirmedCents: r.confirmed_cents ?? null,
    receipts: rec.filter((c) => c.request_id === r.id).map((c) => ({ id: c.id as string, actor: c.actor as string, mime: c.mime as string, createdAt: iso(c.created_at)! })) }));
  return { requests, people: await creditPeople() };
}
