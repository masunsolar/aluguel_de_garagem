import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { addRequestReceipt } from "@/lib/services/credit-requests";
import { readReceiptUpload } from "@/lib/files";
import { fail } from "@/lib/errors";

// Admin anexa comprovante em qualquer pedido de crédito (inclusive nos que ele mesmo lançou).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id;
  if (!isUuid(id)) return Response.json({ error: "Pedido não encontrado." }, { status: 404 });
  const f = await readReceiptUpload(req); if (f instanceof Response) return f;
  try {
    return (await addRequestReceipt(id, f.bytes, f.mime, "admin")) ? Response.json({ ok: true }, { status: 201 }) : Response.json({ error: "Pedido não encontrado." }, { status: 404 });
  } catch (e) { return fail(e); }
}
