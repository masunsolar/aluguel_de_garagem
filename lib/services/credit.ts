import "server-only";
import { randomUUID } from "node:crypto";
import { iso, q, sql, tx } from "../db";
import { UserError } from "../errors";
import { nameKey, plateKey, sameOwner, type Who } from "../identity";
import { apartmentKey } from "../apartment";

/**
 * CRÉDITO do vizinho: dinheiro recebido que ainda não pagou nenhuma reserva (pagou a mais, adiantou, PIX avulso).
 *
 * - Todo dinheiro registrado vira um LOTE em `credits` (de quem é: nome, apto e placa da reserva de origem).
 * - Usar crédito numa reserva = linha positiva em `credit_uses`; devolver (reserva cancelada etc.) = linha negativa.
 * - Saldo do lote = valor − soma dos usos. Saldo da pessoa = soma dos lotes dela. "Dela" = mesmo nome E mesmo
 *   apartamento ou placa (identity.sameOwner, mais rígido que o bloqueio). Nada é editado nem apagado; o banco
 *   recusa saldo negativo (trigger).
 * - Regra automática: crédito disponível sempre abate as reservas pendentes da pessoa, da mais antiga para a mais
 *   nova, pulando as que têm comprovante enviado (o admin confere essas). Quando cobre o valor todo, a reserva
 *   fica "pago" sozinha.
 * - Toda operação roda numa transação com o MESMO lock: dois pedidos ao mesmo tempo não gastam o crédito duas vezes.
 */

const LOCK = q`select pg_advisory_xact_lock(727274)`;

/** A reserva identifica o dono do crédito? Precisa do nome e do apartamento ou da placa (ver sameOwner). */
export const identifies = (w: Who) => !!nameKey(w.name) && !!(plateKey(w.plate) || apartmentKey(w.apartment));

export type Lot = { id: string; kind: "pagamento" | "manual"; amountCents: number; remainingCents: number; reservationId: string | null;
  name: string | null; apartment: string | null; plate: string | null; note: string | null; createdAt: string };

/** Lotes com saldo (de todo mundo). Poucas linhas: o filtro por pessoa é feito em JS (sameOwner). */
async function openLots(): Promise<Lot[]> {
  const rows = await sql`select c.*, (c.amount_cents - coalesce((select sum(u.amount_cents) from credit_uses u where u.credit_id = c.id), 0))::int as remaining
    from credits c order by c.created_at, c.id`;
  return rows.filter((r) => r.remaining > 0).map((r) => ({ id: r.id, kind: r.kind, amountCents: r.amount_cents, remainingCents: r.remaining,
    reservationId: r.reservation_id ?? null, name: r.name ?? null, apartment: r.apartment ?? null, plate: r.plate ?? null, note: r.note ?? null, createdAt: iso(r.created_at)! }));
}
/** `all` opcional: para várias pessoas de uma vez, passe o resultado de `openLots()` e evite N consultas. */
export async function lotsFor(who: Who, all?: Lot[]): Promise<Lot[]> {
  if (!identifies(who)) return [];
  return (all ?? await openLots()).filter((l) => sameOwner(who, l));
}
export const sumLots = (lots: Lot[]) => lots.reduce((t, l) => t + l.remainingCents, 0);
export async function balanceFor(who: Who): Promise<number> { return sumLots(await lotsFor(who)); }
export { openLots };

/**
 * Abate de `lotIds` o que falta pagar da reserva `rid` (lotes mais antigos primeiro). Só reserva pendente,
 * ativa e com valor; `withReceipt` = vale mesmo se o vizinho já mandou comprovante (decisão do admin).
 * Se cobrir tudo, marca a reserva como paga. Tudo num comando só; roda depois do LOCK.
 */
function allocQ(rid: string, lotIds: string[], actor: "admin" | "vizinho" | "sistema", withReceipt: boolean) {
  return q`
    with r as (
      select id, (total_cents - coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = reservations.id), 0))::int as due
      from reservations where id = ${rid}::uuid and deleted_at is null and payment_status = 'pendente'
        and status not in ('cancelada', 'bloqueada') and total_cents > 0
        and (${withReceipt}::boolean or not exists (select 1 from payment_receipts c where c.reservation_id = reservations.id))),
    lots as (select c.id, c.created_at, (c.amount_cents - coalesce((select sum(u.amount_cents) from credit_uses u where u.credit_id = c.id), 0))::int as rem
      from credits c where c.id::text = any(string_to_array(${lotIds.join(",")}, ','))),
    av as (select id, rem, (sum(rem) over (order by created_at, id) - rem)::int as before from lots where rem > 0),
    al as (select av.id, least(av.rem, r.due - av.before)::int as take from av, r where av.before < r.due),
    ins as (insert into credit_uses (credit_id, reservation_id, amount_cents, reason)
      select id, ${rid}::uuid, take, 'abatimento' from al where take > 0 returning amount_cents),
    tot as (select coalesce(sum(amount_cents), 0)::int as used from ins),
    upd as (update reservations set payment_status = 'pago', paid_at = now(), updated_at = now()
      where id in (select r.id from r, tot where tot.used > 0 and tot.used >= r.due) returning id),
    ev as (insert into reservation_events (reservation_id, actor, action, details)
      select ${rid}::uuid, ${actor}, 'credito_usado', jsonb_build_object('valor_cents', tot.used, 'quitou', exists (select 1 from upd)) from tot where tot.used > 0 returning 1)
    select tot.used, exists (select 1 from upd) as paid from tot`;
}

/**
 * Devolve para os lotes o crédito que a reserva não pode mais segurar: tudo, se cancelada/bloqueada/excluída
 * (ou `all`), ou o que passar do valor dela (valor diminuiu). Devolve primeiro o último crédito usado.
 */
function settleQ(rid: string, actor: "admin" | "vizinho" | "sistema", all: boolean) {
  return q`
    with r as (select case when ${all}::boolean or deleted_at is not null or status in ('cancelada', 'bloqueada') then 0 else total_cents end as keep
      from reservations where id = ${rid}::uuid),
    per as (select credit_id, sum(amount_cents)::int as s, max(id) as last from credit_uses
      where reservation_id = ${rid}::uuid group by credit_id having sum(amount_cents) > 0),
    need as (select greatest(0, coalesce((select sum(s) from per), 0) - r.keep)::int as x from r),
    o as (select credit_id, s, (sum(s) over (order by last desc) - s)::int as before from per),
    d as (select credit_id, least(s, need.x - before)::int as back from o, need where before < need.x),
    ins as (insert into credit_uses (credit_id, reservation_id, amount_cents, reason)
      select credit_id, ${rid}::uuid, -back, 'devolucao' from d where back > 0 returning amount_cents),
    tot as (select coalesce(-sum(amount_cents), 0)::int as back from ins),
    ev as (insert into reservation_events (reservation_id, actor, action, details)
      select ${rid}::uuid, ${actor}, 'credito_devolvido', jsonb_build_object('valor_cents', tot.back) from tot where tot.back > 0 returning 1)
    select tot.back from tot`;
}

/**
 * Usa o crédito da pessoa nas reservas pendentes dela (mais antigas primeiro; pula as com comprovante, salvo `first`,
 * que também vem na frente). Devolve quanto foi abatido no total.
 */
export async function autoApply(who: Who, actor: "admin" | "vizinho" | "sistema", first?: string): Promise<number> {
  const lots = await lotsFor(who);
  let left = sumLots(lots);
  if (left <= 0) return 0;
  const pend = await sql`select r.id, r.name, r.apartment, r.plate,
      exists (select 1 from payment_receipts c where c.reservation_id = r.id) as has_receipt
    from reservations r where r.deleted_at is null and r.payment_status = 'pendente' and r.status not in ('cancelada', 'bloqueada')
      and r.total_cents > coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = r.id), 0)
    order by r.start_at, r.created_at`;
  const list = pend.filter((p) => p.id === first || (!p.has_receipt && sameOwner(who, p as Who)));
  list.sort((a, b) => Number(b.id === first) - Number(a.id === first));
  const ids = lots.map((l) => l.id);
  let used = 0;
  for (const p of list) {
    if (left <= 0) break;
    const [, rows] = await tx([LOCK, allocQ(p.id, ids, actor, p.id === first)]);
    const u = Number(rows[0]?.used ?? 0); left -= u; used += u;
  }
  return used;
}

/** Devolve o crédito que a reserva não pode mais segurar (ver settleQ). `all` = devolver tudo (ex.: voltou para pendente). */
export async function settle(rid: string, actor: "admin" | "vizinho" | "sistema", all = false): Promise<number> {
  const [, rows] = await tx([LOCK, settleQ(rid, actor, all)]);
  return Number(rows[0]?.back ?? 0);
}

/** Depois de cancelar, excluir ou mudar o valor: devolve o que sobrou e reaplica o crédito nas outras pendências da pessoa. */
export async function reconcile(rid: string, actor: "admin" | "vizinho" | "sistema") {
  const back = await settle(rid, actor);
  if (!back) return;
  const [r] = await sql`select name, apartment, plate from reservations where id = ${rid}`;
  if (r) await autoApply(r as Who, actor);
}

/** Quanto de crédito já abateu cada reserva (mapa id → centavos). */
export async function usedByReservation(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await sql`select reservation_id, sum(amount_cents)::int as s from credit_uses
    where reservation_id::text = any(string_to_array(${ids.join(",")}, ',')) group by reservation_id`;
  return new Map(rows.map((r) => [r.reservation_id as string, r.s as number]));
}

async function reservationForCredit(rid: string) {
  const [r] = await sql`select id, name, apartment, plate, status, payment_status, total_cents,
      coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = reservations.id), 0)::int as credit_cents
    from reservations where id = ${rid} and deleted_at is null`;
  return r ?? null;
}

/**
 * Admin registra o valor que RECEBEU por uma reserva. O dinheiro vira um lote; o lote paga esta reserva
 * (mesmo com comprovante) e o que sobrar paga as outras pendências da pessoa e, depois, fica como crédito.
 * Recebeu menos que o devido: abate o que deu e a reserva continua pendente com o restante.
 */
export async function registerPayment(rid: string, receivedCents: number, note?: string | null) {
  const r = await reservationForCredit(rid);
  if (!r) return null;
  if (["cancelada", "bloqueada"].includes(r.status)) throw new UserError("Reserva cancelada ou bloqueio não recebe pagamento.");
  if (r.payment_status === "pago") throw new UserError("Esta reserva já está paga. Para guardar um valor recebido a mais, use “Lançar crédito”.");
  const due = r.total_cents - r.credit_cents;
  if (due <= 0) throw new UserError("Esta reserva não tem valor a pagar.");
  if (receivedCents > due && !identifies(r as Who)) throw new UserError("Para guardar o que sobrar como crédito, a reserva precisa ter o nome e o apartamento ou a placa.");
  const id = randomUUID();
  const details = JSON.stringify({ recebido_cents: receivedCents, devido_cents: due, ...(note && { obs: note }) });
  const [, , , rows] = await tx([LOCK,
    q`insert into credits (id, amount_cents, kind, reservation_id, name, apartment, plate, note)
      values (${id}::uuid, ${receivedCents}, 'pagamento', ${rid}::uuid, ${r.name ?? null}, ${r.apartment ?? null}, ${r.plate ?? null}, ${note ?? null})`,
    q`insert into reservation_events (reservation_id, actor, action, details) values (${rid}::uuid, 'admin', 'pagamento_registrado', ${details}::jsonb)`,
    allocQ(rid, [id], "admin", true)]);
  const usedHere = Number(rows[0]?.used ?? 0);
  const spread = identifies(r as Who) ? await autoApply(r as Who, "admin") : 0;
  return { paid: !!rows[0]?.paid, usedHereCents: usedHere, otherReservationsCents: spread, creditLeftCents: await balanceFor(r as Who) };
}

/** Admin lança um crédito avulso para a pessoa desta reserva (ex.: PIX recebido sem reserva). Já abate as pendências dela. */
export async function addManualCredit(rid: string, amountCents: number, note?: string | null) {
  const r = await reservationForCredit(rid);
  if (!r) return null;
  if (r.status === "bloqueada" || !identifies(r as Who)) throw new UserError("Para lançar crédito, a reserva precisa ter o nome e o apartamento ou a placa de quem pagou.");
  const details = JSON.stringify({ valor_cents: amountCents, ...(note && { obs: note }) });
  await sql`with c as (insert into credits (amount_cents, kind, reservation_id, name, apartment, plate, note)
      values (${amountCents}, 'manual', ${rid}::uuid, ${r.name ?? null}, ${r.apartment ?? null}, ${r.plate ?? null}, ${note ?? null}) returning id)
    insert into reservation_events (reservation_id, actor, action, details) select ${rid}::uuid, 'admin', 'credito_lancado', ${details}::jsonb from c`;
  const used = await autoApply(r as Who, "admin");
  return { usedCents: used, creditLeftCents: await balanceFor(r as Who) };
}

/** Admin usa o crédito da pessoa NESTA reserva (mesmo com comprovante enviado). */
export async function useCreditOn(rid: string) {
  const r = await reservationForCredit(rid);
  if (!r) return null;
  const lots = await lotsFor(r as Who);
  if (!sumLots(lots)) throw new UserError("Esta pessoa não tem crédito disponível.");
  const [, rows] = await tx([LOCK, allocQ(rid, lots.map((l) => l.id), "admin", true)]);
  return { usedCents: Number(rows[0]?.used ?? 0), paid: !!rows[0]?.paid, creditLeftCents: await balanceFor(r as Who) };
}

/** Admin zera o saldo de um lote (ex.: devolveu o dinheiro ao vizinho ou lançou por engano). Fica no histórico. */
export async function writeOffLot(lotId: string, note?: string | null) {
  const [, rows] = await tx([LOCK, q`
    with c as (select id, reservation_id, (amount_cents - coalesce((select sum(u.amount_cents) from credit_uses u where u.credit_id = credits.id), 0))::int as rem
      from credits where id = ${lotId}::uuid),
    ins as (insert into credit_uses (credit_id, reservation_id, amount_cents, reason) select id, null, rem, 'baixa' from c where rem > 0 returning amount_cents),
    ev as (insert into reservation_events (reservation_id, actor, action, details)
      select c.reservation_id, 'admin', 'credito_baixa', jsonb_build_object('valor_cents', ins.amount_cents, 'obs', ${note ?? null}::text) from c, ins returning 1)
    select (select count(*) from c)::int as found, coalesce((select amount_cents from ins), 0)::int as removed`]);
  return rows[0]?.found ? Number(rows[0].removed) : null;
}

/** Para o editor do admin: crédito já abatido nesta reserva (com a origem) e saldo disponível da pessoa. */
export async function creditInfo(rid: string, who: Who) {
  const uses = await sql`select u.amount_cents, u.reason, u.created_at, c.kind, c.created_at as credit_at, c.amount_cents as credit_amount
    from credit_uses u join credits c on c.id = u.credit_id where u.reservation_id = ${rid} order by u.id`;
  const lots = await lotsFor(who);
  return {
    usedCents: uses.reduce((t, u) => t + u.amount_cents, 0),
    uses: uses.map((u) => ({ amountCents: u.amount_cents as number, reason: u.reason as string, createdAt: iso(u.created_at)!,
      creditKind: u.kind as string, creditAt: iso(u.credit_at)!, creditAmountCents: u.credit_amount as number })),
    balanceCents: sumLots(lots), lots,
  };
}

/**
 * Reservas JÁ PAGAS deste aparelho (cookie assinado), mais recentes primeiro. Pago = o admin confirmou dinheiro
 * dessa pessoa vindo deste aparelho. Quem só digitou os dados de outro vizinho não tem reserva paga, então não
 * vê nem usa o crédito dele.
 */
async function paidInSession(sessionIds: string[]): Promise<Who[]> {
  const ids = sessionIds.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!ids.length) return [];
  return (await sql`select name, apartment, plate from reservations where id::text = any(string_to_array(${ids.join(",")}, ','))
    and deleted_at is null and payment_status = 'pago' order by created_at desc`) as Who[];
}
/** A reserva nova (dados digitados) é de alguém que já pagou por este aparelho? Só então o crédito abate sozinho. */
export async function sessionIsPerson(sessionIds: string[], who: Who): Promise<boolean> {
  return identifies(who) && (await paidInSession(sessionIds)).some((r) => sameOwner(r, who));
}
/** Saldo mostrado ao vizinho: o da pessoa da reserva paga mais recente deste aparelho (0 se não houver). */
export async function sessionBalance(sessionIds: string[]): Promise<number> {
  const [r] = await paidInSession(sessionIds);
  return r ? balanceFor(r) : 0;
}
