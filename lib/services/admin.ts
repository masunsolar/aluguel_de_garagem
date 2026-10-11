import "server-only";
import { z } from "zod";
import { iso, json, sql } from "../db";
import { RULES } from "../rules";
import { ConflictError, UserError } from "../errors";
import { brl, calculatePrice } from "../pricing";
import { getPricing } from "../settings";
import { fmtBR } from "../time";
import { adminCreateSchema, adminPatchSchema } from "../validation";

const FIELDS = {
  startAt: ["start_at", "entrada"], endAt: ["end_at", "saída"], status: ["status", "status"], name: ["name", "responsável"],
  apartment: ["apartment", "apartamento"], carBrand: ["car_brand", "marca"], carModel: ["car_model", "modelo"],
  carColor: ["car_color", "cor"], plate: ["plate", "placa"], notes: ["notes", "observações"], totalCents: ["total_cents", "valor"],
} as const;
type Key = keyof typeof FIELDS;
// Normaliza datas para ISO e remove o hash do código de acompanhamento
const strip = ({ access_hash, ...r }: any) => ({ ...r, start_at: iso(r.start_at), end_at: iso(r.end_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at), deleted_at: iso(r.deleted_at) });

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
  const rows = await sql`select r.*, (select count(*)::int from reservation_photos p where p.reservation_id = r.id) as photo_count
    from reservations r where r.deleted_at is null order by r.start_at desc`;
  return rows.map(strip);
}

export async function getDetail(id: string) {
  const [r] = await sql`select * from reservations where id = ${id} and deleted_at is null`;
  if (!r) return null;
  const events = await sql`select actor, action, details, created_at from reservation_events where reservation_id = ${id} order by created_at, id`;
  const photos = await sql`select id from reservation_photos where reservation_id = ${id} order by created_at`;
  return { ...strip(r), events: events.map((e) => ({ ...e, details: json(e.details), created_at: iso(e.created_at) })), photos: photos.map((p) => p.id as string) };
}

export async function createAdmin(i: z.infer<typeof adminCreateSchema>) {
  const start = new Date(i.startAt), end = new Date(i.endAt);
  if (end <= start) throw new UserError("A saída precisa ser depois da entrada.");
  const total = i.totalCents ?? (i.status === "bloqueada" ? 0 : calculatePrice(start, end, await getPricing()).totalCents);
  const action = i.status === "bloqueada" ? "bloqueio_criado" : "criada_manualmente";
  const details = JSON.stringify({ status: i.status, entrada: fmtBR(start), saida: fmtBR(end), valor: brl(total), motivo_ou_obs: i.notes ?? null });
  try {
    const r = await sql`
      with r as (insert into reservations (start_at, end_at, total_cents, status, source, name, apartment, car_brand, car_model, car_color, plate, notes)
        values (${start.toISOString()}, ${end.toISOString()}, ${total}, ${i.status}, 'admin', ${i.name ?? null}, ${i.apartment ?? null},
                ${i.carBrand ?? null}, ${i.carModel ?? null}, ${i.carColor ?? null}, ${i.plate || null}, ${i.notes ?? null}) returning id)
      insert into reservation_events (reservation_id, actor, action, details) select id, 'admin', ${action}, ${details}::jsonb from r
      returning reservation_id as id`;
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
  for (const k of Object.keys(FIELDS) as Key[]) if (patch[k] !== undefined && !(k === "totalCents" && patch[k] === null)) apply(FIELDS[k][0], FIELDS[k][1], patch[k]);

  if (new Date(next.end_at) <= new Date(next.start_at)) throw new UserError("A saída precisa ser depois da entrada.");
  // Valor contratado NUNCA muda sozinho: ao mudar o horário o admin escolhe "keep" (padrão) ou "recalc" (preços atuais).
  const timesChanged = "entrada" in changes || "saída" in changes;
  let preco: "manual" | "recalculado" | "mantido" | undefined;
  if ("valor" in changes) preco = "manual";
  else if (timesChanged && next.status !== "bloqueada") {
    if (patch.priceMode === "recalc") { apply("total_cents", "valor", calculatePrice(new Date(next.start_at), new Date(next.end_at), await getPricing()).totalCents); preco = "recalculado"; }
    else preco = "mantido";
  }

  const statusChanged = next.status !== cur.status;
  if (!statusChanged && !Object.keys(changes).length) return true;
  const action = statusChanged ? "status_alterado" : "editada";
  const details = JSON.stringify({ ...(statusChanged && { from: cur.status, to: next.status }), changes, ...(preco && { preco }) });
  const s = new Date(next.start_at), e = new Date(next.end_at);
  try {
    const r = await sql`
      with u as (update reservations set start_at = ${s.toISOString()}, end_at = ${e.toISOString()}, status = ${next.status},
        total_cents = ${next.total_cents}, name = ${next.name}, apartment = ${next.apartment}, car_brand = ${next.car_brand},
        car_model = ${next.car_model}, car_color = ${next.car_color}, plate = ${next.plate}, notes = ${next.notes}, updated_at = now()
        where id = ${id} and deleted_at is null returning id)
      insert into reservation_events (reservation_id, actor, action, details) select id, 'admin', ${action}, ${details}::jsonb from u
      returning reservation_id`;
    return r.length > 0;
  } catch (err) { return clash(err, s, e, id); }
}

export async function softDelete(id: string) {
  const r = await sql`with u as (update reservations set deleted_at = now(), updated_at = now() where id = ${id} and deleted_at is null returning id)
    insert into reservation_events (reservation_id, actor, action, details) select id, 'admin', 'excluida', '{}'::jsonb from u returning reservation_id`;
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

/** Quanto custaria um horário com os preços ATUAIS (só consulta; não altera nada). */
export async function quote(startAt: string, endAt: string) {
  const q = calculatePrice(new Date(startAt), new Date(endAt), await getPricing());
  return { totalCents: q.totalCents, days: q.days, nights: q.nights };
}
