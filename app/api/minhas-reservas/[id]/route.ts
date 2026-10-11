import { neighborIds } from "@/lib/auth";
import { cancelMine } from "@/lib/services/public";
import { limited, tooMany } from "@/lib/ratelimit";
import { isUuid } from "@/lib/validation";

// O vizinho só cancela o que consta na SUA sessão assinada. Conhecer/adivinhar um id não dá permissão (BOLA).
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await limited(req, "cancelar", 10, 3600)) return tooMany();
  const id = (await params).id;
  const mine = await neighborIds();
  if (!isUuid(id) || !mine.includes(id) || !(await cancelMine(id)))
    return Response.json({ error: "Reserva não encontrada ou não pode mais ser cancelada." }, { status: 404 });
  return Response.json({ ok: true });
}
