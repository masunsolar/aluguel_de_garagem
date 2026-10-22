import { neighborCreditIds } from "@/lib/auth";
import { addRequestReceipt } from "@/lib/services/credit-requests";
import { limited, tooMany } from "@/lib/ratelimit";
import { isUuid } from "@/lib/validation";
import { readReceiptUpload } from "@/lib/files";
import { fail } from "@/lib/errors";

// Comprovante do pedido de crédito: só o dono (sessão assinada) e só enquanto o pedido está pendente.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await limited(req, "comprovante", 10, 3600)) return tooMany();
  const id = (await params).id;
  if (!isUuid(id) || !(await neighborCreditIds()).includes(id)) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
  const f = await readReceiptUpload(req); if (f instanceof Response) return f;
  try {
    return (await addRequestReceipt(id, f.bytes, f.mime, "vizinho")) ? Response.json({ ok: true }, { status: 201 }) : Response.json({ error: "Pedido não encontrado." }, { status: 404 });
  } catch (e) { return fail(e); }
}
