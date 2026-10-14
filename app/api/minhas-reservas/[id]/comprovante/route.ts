import { neighborIds } from "@/lib/auth";
import { addReceiptMine } from "@/lib/services/public";
import { limited, tooMany } from "@/lib/ratelimit";
import { isUuid } from "@/lib/validation";
import { sniff } from "@/lib/files";
import { fail } from "@/lib/errors";
import { RULES } from "@/lib/rules";

// O vizinho só envia comprovante para reserva que consta na SUA sessão assinada (mesma regra do cancelamento).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await limited(req, "comprovante", 10, 3600)) return tooMany();
  const id = (await params).id;
  if (!isUuid(id) || !(await neighborIds()).includes(id)) return Response.json({ error: "Reserva não encontrada." }, { status: 404 });
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File) || file.size > RULES.maxPhotoBytes) return Response.json({ error: "Envie uma imagem ou PDF de até 2 MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) return Response.json({ error: "Envie uma imagem (JPG/PNG) ou PDF." }, { status: 400 });
  try { await addReceiptMine(id, bytes, mime); return Response.json({ ok: true }, { status: 201 }); } catch (e) { return fail(e); }
}
