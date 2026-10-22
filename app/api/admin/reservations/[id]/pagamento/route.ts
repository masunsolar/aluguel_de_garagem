import { requireAdmin } from "@/lib/auth";
import { isUuid, paymentSchema } from "@/lib/validation";
import { registerPayment } from "@/lib/services/credit";
import { fail } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Reserva não encontrada." }, { status: 404 });

// Admin registra quanto RECEBEU. Paga esta reserva; o que sobrar paga as outras pendências da pessoa e vira crédito.
export async function POST(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return notFound();
  const p = paymentSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const r = await registerPayment(id, p.data.receivedCents, p.data.note);
    return r ? Response.json(r) : notFound();
  } catch (e) { return fail(e); }
}
