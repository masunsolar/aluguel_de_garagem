import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { logCharge } from "@/lib/services/admin";
import { fail } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

// O envio em si acontece no WhatsApp do admin (link wa.me). Aqui só fica o registro no histórico.
export async function POST(_: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id;
  if (!isUuid(id)) return Response.json({ error: "Reserva não encontrada." }, { status: 404 });
  try {
    const n = await logCharge(id);
    return n === null ? Response.json({ error: "Reserva não encontrada." }, { status: 404 }) : Response.json({ ok: true, itens: n });
  } catch (e) { return fail(e); }
}
