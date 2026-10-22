import "server-only";
import { iso, sql } from "../db";
import { samePerson, type Who } from "../identity";

/**
 * Pendências de pagamento de uma PESSOA: reservas que JÁ COMEÇARAM (a vaga foi usada), não pagas,
 * não canceladas/bloqueadas/excluídas e SEM comprovante enviado (comprovante a conferir não trava o vizinho).
 * Reservas futuras não contam: ninguém deve nada por algo que ainda não usou. O que já foi abatido com crédito
 * não é dívida: só conta a reserva em que ainda falta algo (total − crédito > 0).
 * A pessoa é reconhecida por nome, placa OU apartamento (lib/identity.ts): trocar de celular ou de
 * apartamento digitado não escapa da cobrança nem do bloqueio.
 */
// credit_cents = quanto já foi abatido com crédito/pagamento parcial; o que falta é total_cents − credit_cents.
export type ChargeRow = { id: string; start_at: string; end_at: string; total_cents: number; fee_cents: number; credit_cents: number };
type OpenRow = Record<string, any>;
/** Todas as reservas usadas e em aberto (uma consulta só; quem filtra por pessoa é `unpaidUsedFor`). */
export async function openUsedRows(): Promise<OpenRow[]> {
  return sql`select * from (select id, name, apartment, plate, start_at, end_at, total_cents, fee_cents,
        coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = r.id), 0)::int as credit_cents
      from reservations r
      where deleted_at is null and payment_status = 'pendente' and status not in ('cancelada','bloqueada')
        and start_at <= now() and total_cents > 0
        and not exists (select 1 from payment_receipts c where c.reservation_id = r.id)) x
    where total_cents > credit_cents
    order by start_at`;
}
/** `rows` opcional: para várias pessoas de uma vez, passe o resultado de `openUsedRows()` e evite N consultas. */
export async function unpaidUsedFor(who: Who, rows?: OpenRow[]): Promise<ChargeRow[]> {
  if (!who.name && !who.apartment && !who.plate) return [];
  return (rows ?? await openUsedRows()).filter((r) => samePerson(who, r as Who))
    .map((r) => ({ id: r.id as string, start_at: iso(r.start_at)!, end_at: iso(r.end_at)!, total_cents: r.total_cents as number, fee_cents: Number(r.fee_cents ?? 0), credit_cents: Number(r.credit_cents ?? 0) }));
}
