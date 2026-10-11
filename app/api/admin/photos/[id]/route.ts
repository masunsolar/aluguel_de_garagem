import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { deletePhoto, getPhoto } from "@/lib/services/admin";

// Fotos NÃO são arquivos públicos: só saem daqui, e só com sessão de admin.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id;
  const p = isUuid(id) ? await getPhoto(id) : null;
  if (!p) return new Response("Não encontrada", { status: 404 });
  return new Response(new Uint8Array(p.bytes), { headers: { "Content-Type": p.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
}
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id;
  return isUuid(id) && (await deletePhoto(id)) ? Response.json({ ok: true }) : Response.json({ error: "Foto não encontrada." }, { status: 404 });
}
