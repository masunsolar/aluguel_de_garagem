import "server-only";
import { z } from "zod";
import { iso, json, sql } from "../db";
import { RULES } from "../rules";
import { ConflictError, UserError } from "../errors";
import { brl, calculatePrice } from "../pricing";
import { getPricing } from "../settings";
import { fmtBR } from "../time";
import { adminCreateSchema, adminPatchSchema } from "../validation";
import { openUsedRows, unpaidUsedFor, type ChargeRow } from "./debts";
import { nameKey, plateKey } from "../identity";
import { apartmentKey } from "../apartment";
import { autoApply, creditInfo, lotsFor, openLots, reconcile, settle, sumLots } from "./credit";
import type { Who } from "../identity";

const FIELDS = {
  startAt: ["start_at", "entrada"], endAt: ["end_at", "saída"], status: ["status", "status"], name: ["name", "responsável"],
  apartment: ["apartment", "apartamento"], carBrand: ["car_brand", "marca"], carModel: ["car_model", "modelo"],
  carColor: ["car_color", "cor"], plate: ["plate", "placa"], notes: ["notes", "observações"], totalCents: ["total_cents", "valor"],
  paymentStatus: ["payment_status", "pagamento"], phone: ["phone", "telefone"],
} as const;
type Key = keyof typeof FIELDS;
// Normaliza datas para ISO e remove o hash do código de acompanhamento
const strip = ({ access_hash, ...r }: any) => ({ ...r, price_breakdown: json(r.price_breakdown) ?? null, paid_at: iso(r.paid_at), start_at: iso(r.start_at), end_at: iso(r.end_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at), deleted_at: iso(r.deleted_at) });

// Todo evento é gravado no MESMO comando SQL da mudança (CTE): não há como mudar sem deixar histórico.
async function clash(e: any, start: Date, end: Date, selfId: string | null): Promise<never> {
  if (e?.code !== "23P01") throw e;
  const rows = await sql`select id, name, apartment, status, start_at, end_at from reservations
    where deleted_at is null and status in ('pendente','confirmada','em_andamento','bloqueada','irregular')
      and tstzrange(start_at, end_at, '[)') && tstzrange(${start.toISOString()}::timestamptz, ${end.toISOString()}::timestamptz, '[)')
      and id is distinct from ${selfId}::uuid order by start_at`;
  const conflicts = rows.map((r) => ({ id: r.id as string,
    label: `${r.status === "bloqueada" ? "Horário bloqueado" : `${r.name ?? "Sem identificação"}${r.apartment ? ` (apto ${r.apartment})` : ""}`}: ${fmtBR(r.start_at)} → ${fmtBR(r.end_at)}` }));
  throw new ConflictError(`Conflito com outra reserva ativa. ${conflicts.map((c) => c.label).join(" | ")}`, conflicts);
}

export async function listAll() {
  const rows = await sql`select r.*, (select count(*)::int from reservation_photos p where p.reservation_id = r.id) as photo_count,
    (select count(*)::int from payment_receipts c where c.reservation_id = r.id) as receipt_count,
    coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = r.id), 0)::int as credit_cents
    from reservations r where r.deleted_at is null order by r.start_at desc`;
  return rows.map(strip);
}

export async function getDetail(id: string) {
  const [r] = await sql`select *, coalesce((select sum(u.amount_cents) from credit_uses u where u.reservation_id = reservations.id), 0)::int as credit_cents
    from reservations where id = ${id} and deleted_at is null`;
  if (!r) return null;
  const events = await sql`select actor, action, details, created_at from reservation_events where reservation_id = ${id} order by created_at, id`;
  const photos = await sql`select id from reservation_photos where reservation_id = ${id} order by created_at`;
  const receipts = await sql`select id, mime, created_at from payment_receipts where reservation_id = ${id} order by created_at`;
  // Para o botão "Cobrar": pendências já usadas do mesmo apartamento + esta reserva (mesmo que futura), se estiver em aberto
  const row = strip(r);
  const charge: ChargeRow[] = row.status === "bloqueada" ? [] : await unpaidUsedFor({ name: r.name, apartment: r.apartment, plate: r.plate });
  if (row.payment_status === "pendente" && !["cancelada", "bloqueada"].includes(row.status) && row.total_cents > row.credit_cents && !charge.some((c) => c.id === id))
    charge.push({ id, start_at: row.start_at, end_at: row.end_at, total_cents: row.total_cents, fee_cents: row.fee_cents ?? 0, credit_cents: row.credit_cents });
  charge.sort((a, b) => a.start_at.localeCompare(b.start_at));
  const credit = row.status === "bloqueada" ? null : await creditInfo(id, r as Who);
  return { ...row, charge, credit, events: events.map((e) => ({ ...e, details: json(e.details), created_at: iso(e.created_at) })), photos: photos.map((p) => p.id as string),
    receipts: receipts.map((c) => ({ id: c.id as string, mime: c.mime as string, created_at: iso(c.created_at) })) };
}

export async function createAdmin(i: z.infer<typeof adminCreateSchema>) {
  const start = new Date(i.startAt), end = new Date(i.endAt);
  if (end <= start) throw new UserError("A saída precisa ser depois da entrada.");
  // Detalhamento só quando o valor sai do cálculo; valor digitado à mão ou bloqueio não têm períodos
  const calc = i.totalCents == null && i.status !== "bloqueada" ? calculatePrice(start, end, await getPricing()) : null;
  const fee = i.status === "bloqueada" ? 0 : i.feeCents ?? 0; // taxa extra (ex.: sem agendamento), somada ao uso
  const total = (i.totalCents ?? calc?.totalCents ?? 0) + fee;
  const breakdown = calc ? JSON.stringify(calc.breakdown) : null;
  const action = i.status === "bloqueada" ? "bloqueio_criado" : "criada_manualmente";
  const pay = i.paymentStatus ?? "pendente"; // toda reserva entra como pagamento pendente, salvo se o admin já marcar como pago
  const details = JSON.stringify({ status: i.status, entrada: fmtBR(start), saida: fmtBR(end), valor: brl(total), ...(fee > 0 && { taxa: brl(fee) }), pagamento: pay, motivo_ou_obs: i.notes ?? null });
  try {
    const r = await sql`
      with r as (insert into reservations (start_at, end_at, total_cents, fee_cents, price_breakdown, payment_status, paid_at, status, source, name, apartment, car_brand, car_model, car_color, plate, notes, phone)
        values (${start.toISOString()}, ${end.toISOString()}, ${total}, ${fee}, ${breakdown}::jsonb, ${pay}, ${pay === "pago" ? new Date().toISOString() : null}, ${i.status}, 'admin', ${i.name ?? null}, ${i.apartment ?? null},
                ${i.carBrand ?? null}, ${i.carModel ?? null}, ${i.carColor ?? null}, ${i.plate || null}, ${i.notes ?? null}, ${i.phone || null}) returning id)
      insert into reservation_events (reservation_id, actor, action, details) select id, 'admin', ${action}, ${details}::jsonb from r
      returning reservation_id as id`;
    // crédito que a pessoa já tem paga este registro (ex.: estacionou sem agendar e já tinha deixado dinheiro)
    if (i.status !== "bloqueada" && pay === "pendente") await autoApply({ name: i.name, apartment: i.apartment, plate: i.plate }, "admin");
    return r[0].id as string;
  } catch (e) { return clash(e, start, end, null); }
}

export async function updateAdmin(id: string, patch: z.infer<typeof adminPatchSchema>) {
  const [cur] = await sql`select * from reservations where id = ${id} and deleted_at is null`;
  if (!cur) return false;
  const next: Record<string, any> = { ...cur };
  const changes: Record<string, { from: any; to: any }> = {};
  const show = (col: string, v: any) => (v == null || v === "" ? null : col.endsWith("_at") ? fmtBR(v) : col === "total_cents" ? brl(v) : v);
  const apply = (col: string, label: string, v: any) => {
    const nv = col.endsWith("_at") ? new Date(v).toISOString() : v === "" ? null : v;
    const ov = col.endsWith("_at") ? new Date(cur[col]).toISOString() : cur[col];
    if (nv !== ov && col !== "status") changes[label] = { from: show(col, cur[col]), to: show(col, nv) };
    next[col] = nv;
  };
  for (const k of Object.keys(FIELDS) as Key[]) if (k !== "totalCents" && patch[k] !== undefined) apply(FIELDS[k][0], FIELDS[k][1], patch[k]);

  if (new Date(next.end_at) <= new Date(next.start_at)) throw new UserError("A saída precisa ser depois da entrada.");
  // Valor contratado NUNCA muda sozinho: ao mudar o horário o admin escolhe "keep" (padrão) ou "recalc" (preços atuais).
  // total_cents = uso + taxa. O admin edita os dois separados; a taxa sobrevive a recalcular o uso.
  const timesChanged = "entrada" in changes || "saída" in changes;
  const curFee = Number(cur.fee_cents ?? 0), curUse = cur.total_cents - curFee;
  const fee = next.status === "bloqueada" ? 0 : patch.feeCents ?? curFee;
  let use = curUse;
  let preco: "manual" | "recalculado" | "mantido" | undefined;
  if (patch.totalCents != null && patch.totalCents !== curUse) { use = patch.totalCents; preco = "manual"; }
  else if (timesChanged && next.status !== "bloqueada") {
    if (patch.priceMode === "recalc") {
      const q = calculatePrice(new Date(next.start_at), new Date(next.end_at), await getPricing());
      use = q.totalCents; next.price_breakdown = q.breakdown; preco = "recalculado";
    } else { next.price_breakdown = null; preco = "mantido"; } // valor mantido com outro horário: o detalhamento antigo não vale mais
  }
  if (fee !== curFee) changes["taxa"] = { from: brl(curFee), to: brl(fee) };
  apply("total_cents", "valor", use + fee); next.fee_cents = fee;

  // Data do pagamento: registrada quando passa a "pago"; some se voltar a "pendente"
  next.paid_at = next.payment_status === "pago" ? (cur.payment_status === "pago" ? cur.paid_at : new Date()) : null;
  const statusChanged = next.status !== cur.status;
  if (!statusChanged && !Object.keys(changes).length) return true;
  const action = statusChanged ? "status_alterado" : "editada";
  const details = JSON.stringify({ ...(statusChanged && { from: cur.status, to: next.status }), changes, ...(preco && { preco }) });
  const s = new Date(next.start_at), e = new Date(next.end_at);
  try {
    const r = await sql`
      with u as (update reservations set start_at = ${s.toISOString()}, end_at = ${e.toISOString()}, status = ${next.status},
        total_cents = ${next.total_cents}, fee_cents = ${next.fee_cents}, price_breakdown = ${next.price_breakdown == null ? null : JSON.stringify(json(next.price_breakdown))}::jsonb, name = ${next.name}, apartment = ${next.apartment}, car_brand = ${next.car_brand},
        car_model = ${next.car_model}, car_color = ${next.car_color}, plate = ${next.plate}, notes = ${next.notes}, phone = ${next.phone},
        payment_status = ${next.payment_status}, paid_at = ${next.paid_at ? new Date(next.paid_at).toISOString() : null}, updated_at = now()
        where id = ${id} and deleted_at is null returning id)
      insert into reservation_events (reservation_id, actor, action, details) select id, 'admin', ${action}, ${details}::jsonb from u
      returning reservation_id`;
    if (!r.length) return false;
  } catch (err) { return clash(err, s, e, id); }
  // Crédito: "voltar para pendente" devolve todo o crédito abatido (é desfazer o pagamento) e não reaplica.
  // Nos demais casos devolve o que a reserva não pode mais segurar (cancelou, valor diminuiu) e reaplica nas pendências.
  if (cur.payment_status === "pago" && next.payment_status === "pendente") await settle(id, "admin", true);
  else { await settle(id, "admin"); await autoApply({ name: next.name, apartment: next.apartment, plate: next.plate }, "admin"); }
  return true;
}

export async function softDelete(id: string) {
  const r = await sql`with u as (update reservations set deleted_at = now(), updated_at = now() where id = ${id} and deleted_at is null returning id)
    insert into reservation_events (reservation_id, actor, action, details) select id, 'admin', 'excluida', '{}'::jsonb from u returning reservation_id`;
  if (r.length) await reconcile(id, "admin"); // crédito abatido nela volta para a pessoa
  return r.length > 0;
}

export async function addPhoto(id: string, bytes: Buffer) {
  const [ok] = await sql`select (select count(*) from reservation_photos where reservation_id = ${id}) as n
                         from reservations where id = ${id} and deleted_at is null`;
  if (!ok) throw new UserError("Reserva não encontrada.");
  if (Number(ok.n) >= RULES.maxPhotos) throw new UserError(`Limite de ${RULES.maxPhotos} fotos por reserva.`);
  await sql`with p as (insert into reservation_photos (reservation_id, mime, data) values (${id}, 'image/jpeg', decode(${bytes.toString("base64")}, 'base64')) returning id)
    insert into reservation_events (reservation_id, actor, action, details)
    select ${id}::uuid, 'admin', 'foto_adicionada', jsonb_build_object('photoId', p.id) from p`;
}
export async function deletePhoto(photoId: string) {
  const r = await sql`with d as (delete from reservation_photos where id = ${photoId} returning id, reservation_id)
    insert into reservation_events (reservation_id, actor, action, details)
    select reservation_id, 'admin', 'foto_removida', jsonb_build_object('photoId', id) from d returning reservation_id`;
  return r.length > 0;
}
export async function getPhoto(id: string) {
  const [p] = await sql`select mime, encode(data, 'base64') as b64 from reservation_photos where id = ${id}`;
  return p ? { mime: p.mime as string, bytes: Buffer.from(p.b64, "base64") } : null;
}

/**
 * Moradores que já usaram a garagem, montados a partir das reservas (não existe cadastro separado).
 * Agrupa por nome + apartamento; os dados (carro, placa, WhatsApp) vêm da reserva mais recente, completando
 * com as anteriores o que estiver vazio. `pendingCents` usa a mesma regra do bloqueio (nome, placa ou apto).
 */
export async function listResidents() {
  const rows = await sql`select r.id, r.name, r.apartment, r.phone, r.car_brand, r.car_model, r.car_color, r.plate, r.start_at, r.status
    from reservations r where r.deleted_at is null and r.status not in ('bloqueada','cancelada') and coalesce(trim(r.name), '') <> ''
    order by r.start_at desc`;
  type Resident = { key: string; name: string; apartment: string | null; phone: string | null; carBrand: string | null; carModel: string | null;
    carColor: string | null; plate: string | null; plates: string[]; uses: number; lastUse: string; pendingCents: number; pendingCount: number; creditCents: number };
  const byKey = new Map<string, Resident>();
  for (const r of rows) {
    const key = `${nameKey(r.name)}|${apartmentKey(r.apartment)}`;
    if (key.startsWith("|")) continue; // nome curto demais para identificar alguém
    let p = byKey.get(key);
    if (!p) byKey.set(key, p = { key, name: r.name, apartment: r.apartment, phone: r.phone, carBrand: r.car_brand, carModel: r.car_model,
      carColor: r.car_color, plate: r.plate, plates: [], uses: 0, lastUse: iso(r.start_at)!, pendingCents: 0, pendingCount: 0, creditCents: 0 });
    p.phone ??= r.phone; p.carBrand ??= r.car_brand; p.carModel ??= r.car_model; p.carColor ??= r.car_color; p.plate ??= r.plate; p.apartment ??= r.apartment;
    const pk = plateKey(r.plate); if (pk && !p.plates.includes(pk)) p.plates.push(pk);
    p.uses++;
  }
  const list = [...byKey.values()];
  const open = await openUsedRows();
  const debts = await Promise.all(list.map((p) => unpaidUsedFor({ name: p.name, apartment: p.apartment, plate: p.plate }, open)));
  const lots = await openLots();
  const credits = await Promise.all(list.map((p) => lotsFor({ name: p.name, apartment: p.apartment, plate: p.plate }, lots)));
  list.forEach((p, i) => { p.pendingCount = debts[i].length; p.pendingCents = debts[i].reduce((t, d) => t + d.total_cents - d.credit_cents, 0); p.creditCents = sumLots(credits[i]); });
  return list.sort((a, b) => b.lastUse.localeCompare(a.lastUse));
}

/** Quanto custaria um horário com os preços ATUAIS (só consulta; não altera nada). */
export async function quote(startAt: string, endAt: string) {
  const q = calculatePrice(new Date(startAt), new Date(endAt), await getPricing());
  return { totalCents: q.totalCents, days: q.days, nights: q.nights, breakdown: q.breakdown };
}

export async function getReceipt(id: string) {
  const [c] = await sql`select mime, encode(data, 'base64') as b64 from payment_receipts where id = ${id}`;
  return c ? { mime: c.mime as string, bytes: Buffer.from(c.b64, "base64") } : null;
}

/** Registra no histórico de CADA reserva cobrada que a cobrança foi aberta no WhatsApp. Os itens são recalculados aqui (não vêm do navegador). */
export async function logCharge(id: string) {
  const d = await getDetail(id);
  if (!d) return null;
  const items: ChargeRow[] = d.charge;
  if (!items.length) return 0;
  const details = JSON.stringify({ itens: items.length, total: brl(items.reduce((s, i) => s + i.total_cents - (i.credit_cents ?? 0), 0)), telefone: d.phone ?? null });
  const r = await sql`insert into reservation_events (reservation_id, actor, action, details)
    select x::uuid, 'admin', 'cobranca_aberta', ${details}::jsonb from unnest(string_to_array(${items.map((i) => i.id).join(",")}, ',')) as x
    returning reservation_id`;
  return r.length;
}
