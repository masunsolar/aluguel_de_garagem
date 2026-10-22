import { requireAdmin } from "@/lib/auth";
import { creditActionSchema, isUuid } from "@/lib/validation";
import { addManualCredit, useCreditOn } from "@/lib/services/credit";
import { fail } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Reserva não encontrada." }, { status: 404 });

// { action: "usar" }: usa o crédito da pessoa nesta reserva (mesmo com comprovante enviado).
// { action: "lancar", amountCents, note }: lança crédito avulso para a pessoa desta reserva (ex.: PIX sem reserva).
export async function POST(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return notFound();
  const p = creditActionSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const r = p.data.action === "usar" ? await useCreditOn(id) : await addManualCredit(id, p.data.amountCents, p.data.note);
    return r ? Response.json(r) : notFound();
  } catch (e) { return fail(e); }
}
