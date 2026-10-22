import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { addReceiptAdmin } from "@/lib/services/admin";
import { readReceiptUpload } from "@/lib/files";
import { fail } from "@/lib/errors";

// Admin anexa o comprovante de pagamento de uma reserva (ex.: o vizinho mandou pelo WhatsApp).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id;
  if (!isUuid(id)) return Response.json({ error: "Reserva não encontrada." }, { status: 404 });
  const f = await readReceiptUpload(req); if (f instanceof Response) return f;
  try {
    return (await addReceiptAdmin(id, f.bytes, f.mime)) ? Response.json({ ok: true }, { status: 201 }) : Response.json({ error: "Reserva não encontrada." }, { status: 404 });
  } catch (e) { return fail(e); }
}
