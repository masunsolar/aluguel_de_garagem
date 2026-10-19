import "server-only";
import { iso, sql } from "../db";
import { apartmentKey } from "../apartment";

/**
 * Pendências de pagamento de um apartamento: reservas que JÁ COMEÇARAM (a vaga foi usada), não pagas,
 * não canceladas/bloqueadas/excluídas e SEM comprovante enviado (comprovante a conferir não trava o vizinho).
 * Reservas futuras não contam: ninguém deve nada por algo que ainda não usou.
 * O apartamento é comparado pela chave normalizada ("Apto 101" = "101"), feita em JS num lugar só.
 */
export type ChargeRow = { id: string; start_at: string; end_at: string; total_cents: number };
export async function unpaidUsedFor(apartment: string | null | undefined): Promise<ChargeRow[]> {
  const key = apartmentKey(apartment);
  if (!key) return [];
  const rows = await sql`select id, apartment, start_at, end_at, total_cents from reservations r
    where deleted_at is null and payment_status = 'pendente' and status not in ('cancelada','bloqueada')
      and start_at <= now() and total_cents > 0
      and not exists (select 1 from payment_receipts c where c.reservation_id = r.id)
    order by start_at`;
  return rows.filter((r) => apartmentKey(r.apartment) === key)
    .map((r) => ({ id: r.id as string, start_at: iso(r.start_at)!, end_at: iso(r.end_at)!, total_cents: r.total_cents as number }));
}
