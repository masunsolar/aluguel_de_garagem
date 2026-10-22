import { requireAdmin } from "@/lib/auth";
import { creditDecisionSchema, isUuid } from "@/lib/validation";
import { confirmRequest, rejectRequest } from "@/lib/services/credit-requests";
import { fail } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Pedido não encontrado." }, { status: 404 });

// { action: "confirmar", amountCents, note } cria o crédito com o valor recebido; { action: "recusar", note } recusa.
export async function POST(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return notFound();
  const p = creditDecisionSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const r = p.data.action === "confirmar" ? await confirmRequest(id, p.data.amountCents, p.data.note) : await rejectRequest(id, p.data.note);
    return r === null ? notFound() : Response.json(r === true ? { ok: true } : r);
  } catch (e) { return fail(e); }
}
