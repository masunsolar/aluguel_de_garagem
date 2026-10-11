import { reservationSchema } from "@/lib/validation";
import { createPublic } from "@/lib/services/public";
import { rememberReservation } from "@/lib/auth";
import { limited, tooMany } from "@/lib/ratelimit";
import { fail } from "@/lib/errors";

export async function POST(req: Request) {
  if (await limited(req, "reserva", 8, 3600)) return tooMany(); // 8 reservas/hora por IP
  const body = await req.json().catch(() => null);
  if (body && typeof body.website === "string" && body.website !== "") // isca preenchida = robô: finge sucesso, não grava nada
    return Response.json({ id: "00000000", code: "-", start: new Date(), end: new Date(), totalCents: 0 }, { status: 201 });
  const p = reservationSchema.safeParse(body);
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const r = await createPublic(p.data);
    await rememberReservation(r.id); // este navegador passa a "ser dono" da reserva
    return Response.json({ id: r.shortId, code: r.code, start: r.start, end: r.end, totalCents: r.totalCents }, { status: 201 });
  } catch (e) { return fail(e); }
}
