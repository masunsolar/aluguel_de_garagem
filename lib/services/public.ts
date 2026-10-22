import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { iso, json, sql } from "../db";
import { RULES } from "../rules";
import { effectiveStatus } from "../status";
import { brtDay } from "../time";
import { hashCode } from "../auth";
import { ConflictError, ForbiddenError, UserError } from "../errors";
import { calculatePrice, toDate, type PriceBreakdown } from "../pricing";
import { getAdvanceDays, getMaxUnpaid, getPricing } from "../settings";
import { unpaidUsedFor } from "./debts";
import { reservationSchema } from "../validation";
import { autoApply, reconcile, sessionIsPerson } from "./credit";

// Este módulo só devolve DTOs mínimos. Nada de nome, apto, carro, notas, motivo de bloqueio ou fotos.
export async function getBusy() {
  const rows = await sql`select start_at, end_at from reservations
    where deleted_at is null and status in ('pendente','confirmada','em_andamento','bloqueada','irregular') and end_at > now()
    order by start_at`;
  return rows.map((r) => ({ start: iso(r.start_at), end: iso(r.end_at) }));
}

const DAY = 86_400_000;
/** `sessionIds` = reservas que este navegador já tem (cookie assinado): decide se o crédito da pessoa pode ser usado sozinho. */
export async function createPublic(i: z.infer<typeof reservationSchema>, sessionIds: string[] = [], requestIds: string[] = []) {
  const start = toDate(i.startDate, i.startTime), end = toDate(i.endDate, i.endTime), now = Date.now();
  if (Number.isNaN(+start) || Number.isNaN(+end)) throw new UserError("Data ou horário inválido.");
  if (end <= start) throw new UserError("A saída precisa ser depois da entrada.");
  if (+start < now) throw new UserError("A entrada precisa ser no futuro.");
  const advance = await getAdvanceDays(); // configurável no painel (maximumReservationAdvanceDays)
  if (brtDay(start) > brtDay(new Date(now + advance * DAY))) throw new UserError(`Só é possível reservar com até ${advance} dias de antecedência.`);
  if (+end - +start < RULES.minMinutes * 60_000) throw new UserError(`A reserva mínima é de ${RULES.minMinutes} minutos.`);
  if (+end - +start > RULES.maxDurationDays * DAY) throw new UserError(`A reserva máxima é de ${RULES.maxDurationDays} dias.`);
  const maxUnpaid = await getMaxUnpaid(); // configurável no painel; null = desligado
  // A pessoa é reconhecida por nome, placa OU apartamento: reservar de outro celular ou com outro apto não escapa do bloqueio
  if (maxUnpaid !== null && (await unpaidUsedFor({ name: i.name, apartment: i.apartment, plate: i.plate })).length > maxUnpaid)
    // Mensagem genérica: não diz quantas, de quando nem qual dado bateu (só o admin vê os detalhes)
    throw new ForbiddenError("Não foi possível reservar: há pagamentos pendentes de reservas anteriores. Pague pelo PIX e envie o comprovante em “Minhas reservas”, ou fale com o responsável pela garagem.");
  const { totalCents, breakdown } = calculatePrice(start, end, await getPricing()); // preço SEMPRE calculado aqui; o do navegador é só prévia
  const code = randomBytes(9).toString("base64url"); // código secreto de acompanhamento (72 bits; só o hash é guardado)
  const details = JSON.stringify({ entrada: start.toISOString(), saida: end.toISOString(), totalCents });
  try {
    // reserva + evento de auditoria no MESMO comando: não existe reserva sem histórico
    const r = await sql`
      with r as (insert into reservations (start_at, end_at, total_cents, price_breakdown, status, source, name, apartment, car_brand, car_model, car_color, plate, phone, access_hash)
        values (${start.toISOString()}, ${end.toISOString()}, ${totalCents}, ${JSON.stringify(breakdown)}::jsonb, 'confirmada', 'vizinho', ${i.name}, ${i.apartment},
                ${i.carBrand}, ${i.carModel}, ${i.carColor}, ${i.plate}, ${i.phone || null}, ${hashCode(code)}) returning id)
      insert into reservation_events (reservation_id, actor, action, details) select id, 'vizinho', 'criada', ${details}::jsonb from r
      returning reservation_id as id`;
    const id = r[0].id as string;
    // Crédito (pagou a mais antes) abate sozinho só se ESTE aparelho já tem reserva com o mesmo nome:
    // assim ninguém usa o crédito do vizinho só digitando o apartamento dele. Senão, o admin usa pelo painel.
    let creditUsedCents = 0, paymentStatus = "pendente";
    if (await sessionIsPerson(sessionIds, i, requestIds)) {
      await autoApply(i, "sistema");
      const [x] = await sql`select payment_status, coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = reservations.id), 0)::int as credit
        from reservations where id = ${id}`;
      creditUsedCents = Number(x?.credit ?? 0); paymentStatus = x?.payment_status ?? "pendente";
    }
    return { id, shortId: String(id).slice(0, 8).toUpperCase(), code, start, end, totalCents, breakdown, creditUsedCents, paymentStatus };
  } catch (e: any) {
    if (e?.code === "23P01") throw new ConflictError("Esse horário já está ocupado. Escolha outro.");
    throw e;
  }
}

const toMine = (r: any) => ({
  id: r.id as string, shortId: String(r.id).slice(0, 8).toUpperCase(), start: iso(r.start_at), end: iso(r.end_at), totalCents: r.total_cents,
  feeCents: Number(r.fee_cents ?? 0), // taxa já incluída no total (ex.: estacionou sem agendar)
  breakdown: (json(r.price_breakdown) as PriceBreakdown | null) ?? null, // só períodos e valores; nada pessoal
  paymentStatus: r.payment_status as "pendente" | "pago", receiptCount: Number(r.receipt_count ?? 0),
  creditCents: Number(r.credit_cents ?? 0), // já abatido (crédito ou pagamento parcial); falta pagar totalCents − creditCents
  paidWithCredit: r.payment_status === "pago" && Number(r.other_credit_cents ?? 0) >= r.total_cents && r.total_cents > 0, // quitada com crédito de antes
  status: r.status === "irregular" ? "em_analise" : effectiveStatus(r), // o vizinho não vê a marcação interna; em andamento/finalizada são derivados do horário
});
export async function listMine(ids: string[]) {
  ids = ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  if (!ids.length) return [];
  const rows = await sql`select id, start_at, end_at, status, total_cents, fee_cents, price_breakdown, payment_status,
    (select count(*)::int from payment_receipts c where c.reservation_id = reservations.id) as receipt_count,
    coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = reservations.id), 0)::int as credit_cents,
    coalesce((select sum(u.amount_cents) from credit_uses u join credits c on c.id = u.credit_id
      where u.reservation_id = reservations.id and c.reservation_id is distinct from reservations.id), 0)::int as other_credit_cents from reservations
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
  if (r.length) await reconcile(id, "vizinho"); // crédito usado nela volta para a pessoa
  return r.length > 0;
}

/** Comprovante enviado pelo dono (a rota já confirmou que o id está na sessão dele). Não muda o pagamento: o admin confere e marca. */
export async function addReceiptMine(id: string, bytes: Buffer, mime: string) {
  const [ok] = await sql`select (select count(*) from payment_receipts where reservation_id = ${id}) as n, payment_status
    from reservations where id = ${id} and deleted_at is null and status not in ('cancelada','bloqueada')`;
  if (!ok) throw new UserError("Reserva não encontrada.");
  if (ok.payment_status === "pago") throw new UserError("Esta reserva já está marcada como paga.");
  if (Number(ok.n) >= RULES.maxReceipts) throw new UserError(`Limite de ${RULES.maxReceipts} comprovantes por reserva.`);
  await sql`with c as (insert into payment_receipts (reservation_id, mime, data) values (${id}, ${mime}, decode(${bytes.toString("base64")}, 'base64')) returning id)
    insert into reservation_events (reservation_id, actor, action, details)
    select ${id}::uuid, 'vizinho', 'comprovante_enviado', jsonb_build_object('receiptId', c.id) from c`;
}
