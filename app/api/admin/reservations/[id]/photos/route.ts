import { requireAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/validation";
import { addPhoto } from "@/lib/services/admin";
import { fail } from "@/lib/errors";
import { RULES } from "@/lib/rules";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return Response.json({ error: "Reserva inválida." }, { status: 404 });
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File) || file.size > RULES.maxPhotoBytes) return Response.json({ error: "Envie uma imagem de até 2 MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  // confere o CONTEÚDO (início FFD8FF e fim FFD9 de um JPEG), não o nome nem o Content-Type informado
  const jpeg = bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  if (!jpeg) return Response.json({ error: "Apenas imagens JPEG válidas." }, { status: 400 });
  try { await addPhoto(id, bytes); return Response.json({ ok: true }, { status: 201 }); } catch (e) { return fail(e); }
}
