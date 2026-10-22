import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { getCreditReceipt } from "@/lib/services/credit-requests";
import { privateFileHeaders } from "@/lib/files";

// Comprovantes de pedidos de crédito: privados, só com sessão de admin.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id;
  const c = isUuid(id) ? await getCreditReceipt(id) : null;
  if (!c) return new Response("Não encontrado", { status: 404 });
  return new Response(new Uint8Array(c.bytes), { headers: privateFileHeaders(c.mime) });
}
