import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { iso, sql } from "../db";
import { RULES } from "../rules";
import { effectiveStatus } from "../status";
import { brtDay } from "../time";
import { hashCode } from "../auth";
import { ConflictError, UserError } from "../errors";
import { calculatePrice, toDate } from "../pricing";
import { getAdvanceDays, getPricing } from "../settings";
import { reservationSchema } from "../validation";

// Este módulo só devolve DTOs mínimos. Nada de nome, apto, carro, notas, motivo de bloqueio ou fotos.
export async function getBusy() {
  const rows = await sql`select start_at, end_at from reservations
    where deleted_at is null and status in ('pendente','confirmada','em_andamento','bloqueada','irregular') and end_at > now()
    order by start_at`;
  return rows.map((r) => ({ start: iso(r.start_at), end: iso(r.end_at) }));
}

const DAY = 86_400_000;
export async function createPublic(i: z.infer<typeof reservationSchema>) {
  const start = toDate(i.startDate, i.startTime), end = toDate(i.endDate, i.endTime), now = Date.now();
  if (Number.isNaN(+start) || Number.isNaN(+end)) throw new UserError("Data ou horário inválido.");
  if (end <= start) throw new UserError("A saída precisa ser depois da entrada.");
  if (+start < now) throw new UserError("A entrada precisa ser no futuro.");
  const advance = await getAdvanceDays(); // configurável no painel (maximumReservationAdvanceDays)
  if (brtDay(start) > brtDay(new Date(now + advance * DAY))) throw new UserError(`Só é possível reservar com até ${advance} dias de antecedência.`);
  if (+end - +start < RULES.minMinutes * 60_000) throw new UserError(`A reserva mínima é de ${RULES.minMinutes} minutos.`);
  if (+end - +start > RULES.maxDurationDays * DAY) throw new UserError(`A reserva máxima é de ${RULES.maxDurationDays} dias.`);
  const { totalCents } = calculatePrice(start, end, await getPricing()); // preço SEMPRE calculado aqui; o do navegador é só prévia
  const code = randomBytes(9).toString("base64url"); // código secreto de acompanhamento (72 bits; só o hash é guardado)
  const details = JSON.stringify({ entrada: start.toISOString(), saida: end.toISOString(), totalCents });
  try {
    // reserva + evento de auditoria no MESMO comando: não existe reserva sem histórico
    const r = await sql`
      with r as (insert into reservations (start_at, end_at, total_cents, status, source, name, apartment, car_brand, car_model, car_color, plate, access_hash)
        values (${start.toISOString()}, ${end.toISOString()}, ${totalCents}, 'confirmada', 'vizinho', ${i.name}, ${i.apartment},
                ${i.carBrand}, ${i.carModel}, ${i.carColor}, ${i.plate}, ${hashCode(code)}) returning id)
      insert into reservation_events (reservation_id, actor, action, details) select id, 'vizinho', 'criada', ${details}::jsonb from r
      returning reservation_id as id`;
    return { id: r[0].id as string, shortId: String(r[0].id).slice(0, 8).toUpperCase(), code, start, end, totalCents };
  } catch (e: any) {
    if (e?.code === "23P01") throw new ConflictError("Esse horário já está ocupado. Escolha outro.");
    throw e;
  }
}

const toMine = (r: any) => ({
  id: r.id as string, shortId: String(r.id).slice(0, 8).toUpperCase(), start: iso(r.start_at), end: iso(r.end_at), totalCents: r.total_cents,
  status: r.status === "irregular" ? "em_analise" : effectiveStatus(r), // o vizinho não vê a marcação interna; em andamento/finalizada são derivados do horário
});
export async function listMine(ids: string[]) {
  ids = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!ids.length) return [];
  const rows = await sql`select id, start_at, end_at, status, total_cents from reservations
    where id::text = any(string_to_array(${ids.join(",")}, ',')) and deleted_at is null and status <> 'bloqueada' order by start_at desc`;
  return rows.map(toMine);
}
export async function findByCode(code: string) {
  const r = await sql`select id from reservations where access_hash = ${hashCode(code)} and deleted_at is null`;
  return (r[0] as { id: string } | undefined) ?? null;
}
/** Cancelamento pelo dono (a rota já confirmou que o id está na sessão dele). Só futuras, pendentes/confirmadas. */
export async function cancelMine(id: string) {
  const r = await sql`
    with u as (update reservations set status = 'cancelada', updated_at = now()
      where id = ${id} and deleted_at is null and status in ('pendente','confirmada') and start_at > now() returning id)
    insert into reservation_events (reservation_id, actor, action, details)
    select id, 'vizinho', 'status_alterado', '{"to":"cancelada"}'::jsonb from u returning reservation_id`;
  return r.length > 0;
}
