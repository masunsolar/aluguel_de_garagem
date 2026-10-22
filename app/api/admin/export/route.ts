import { requireAdmin } from "@/lib/auth";
import { iso, json, sql } from "@/lib/db";
import { fmtBR } from "@/lib/time";
export const dynamic = "force-dynamic";

// Backup feito pelo admin. O Neon gratuito só guarda 6 h de histórico para restaurar, então vale baixar de vez em quando.
// Vai: reservas (sem o hash do código de acompanhamento), histórico de eventos e configurações. Não vai: fotos e
// comprovantes (são binários grandes; ficam no banco) nem o "admin_epoch" (controle interno de sessão).
// ?format=csv = só as reservas, para abrir no Excel/Planilhas.
export async function GET(req: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  const day = new Date().toISOString().slice(0, 10);
  const reservations = (await sql`select r.id, r.start_at, r.end_at, r.status, r.source, r.total_cents, r.fee_cents, r.payment_status, r.paid_at,
      r.name, r.apartment, r.car_brand, r.car_model, r.car_color, r.plate, r.phone, r.notes, r.price_breakdown, r.created_at, r.updated_at, r.deleted_at,
      (select count(*)::int from reservation_photos p where p.reservation_id = r.id) as photo_count,
      (select count(*)::int from payment_receipts c where c.reservation_id = r.id) as receipt_count
    from reservations r order by r.start_at`).map((r) => ({ ...r, price_breakdown: json(r.price_breakdown) ?? null,
      start_at: iso(r.start_at), end_at: iso(r.end_at), paid_at: iso(r.paid_at), created_at: iso(r.created_at), updated_at: iso(r.updated_at), deleted_at: iso(r.deleted_at) }));
  const headers = (type: string, ext: string) => ({ "Content-Type": type, "Cache-Control": "private, no-store", "Content-Disposition": `attachment; filename="garagem-backup-${day}.${ext}"` });

  if (new URL(req.url).searchParams.get("format") === "csv") {
    const cols: [string, (r: any) => unknown][] = [["id", (r) => r.id], ["entrada", (r) => fmtBR(r.start_at)], ["saída", (r) => fmtBR(r.end_at)],
      ["status", (r) => r.status], ["origem", (r) => r.source], ["valor", (r) => (r.total_cents / 100).toFixed(2).replace(".", ",")], ["taxa incluída", (r) => (r.fee_cents / 100).toFixed(2).replace(".", ",")],
      ["pagamento", (r) => r.payment_status], ["pago em", (r) => (r.paid_at ? fmtBR(r.paid_at) : "")], ["nome", (r) => r.name], ["apto", (r) => r.apartment],
      ["marca", (r) => r.car_brand], ["modelo", (r) => r.car_model], ["cor", (r) => r.car_color], ["placa", (r) => r.plate], ["telefone", (r) => r.phone],
      ["observações", (r) => r.notes], ["excluída em", (r) => (r.deleted_at ? fmtBR(r.deleted_at) : "")]];
    // ; como separador (Excel em pt-BR). Célula começando com = + - @ vira texto: o vizinho digita o nome, e sem isso
    // um "=HIPERLINK(...)" viraria fórmula ao abrir a planilha (CSV injection).
    const cell = (v: unknown) => { let t = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
    const csv = "﻿" + [cols.map(([h]) => cell(h)).join(";"), ...reservations.map((r) => cols.map(([, f]) => cell(f(r))).join(";"))].join("\r\n");
    return new Response(csv, { headers: headers("text/csv; charset=utf-8", "csv") });
  }

  const events = (await sql`select id, reservation_id, actor, action, details, created_at from reservation_events order by id`)
    .map((e) => ({ ...e, details: json(e.details), created_at: iso(e.created_at) }));
  const settings = Object.fromEntries((await sql`select key, value from settings where key <> 'admin_epoch' order by key`).map((s) => [s.key, json(s.value)]));
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), reservations, events, settings }, null, 2);
  return new Response(body, { headers: headers("application/json; charset=utf-8", "json") });
}
