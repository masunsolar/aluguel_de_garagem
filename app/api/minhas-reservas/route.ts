import { neighborIds, rememberReservation } from "@/lib/auth";
import { listMine, findByCode } from "@/lib/services/public";
import { limited, tooMany } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export async function GET() { return Response.json(await listMine(await neighborIds())); }
// Vincular uma reserva a este navegador usando o código secreto recebido na confirmação
export async function POST(req: Request) {
  if (await limited(req, "codigo", 10, 900)) return tooMany(); // impede tentar códigos em massa
  const { code } = await req.json().catch(() => ({ code: "" }));
  const r = typeof code === "string" && code.length >= 8 && code.length <= 40 ? await findByCode(code.trim()) : null;
  if (!r) return Response.json({ error: "Código não encontrado." }, { status: 404 });
  await rememberReservation(r.id);
  return Response.json({ ok: true });
}
