import { neighborCreditIds } from "@/lib/auth";
import { cancelMineRequest } from "@/lib/services/credit-requests";
import { limited, tooMany } from "@/lib/ratelimit";
import { isUuid } from "@/lib/validation";

// O vizinho só cancela pedido que consta na SUA sessão assinada, e só enquanto pendente.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await limited(req, "cancelar-pedido", 10, 3600)) return tooMany();
  const id = (await params).id;
  if (!isUuid(id) || !(await neighborCreditIds()).includes(id) || !(await cancelMineRequest(id)))
    return Response.json({ error: "Pedido não encontrado ou já analisado." }, { status: 404 });
  return Response.json({ ok: true });
}
