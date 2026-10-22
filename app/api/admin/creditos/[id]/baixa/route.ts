import { requireAdmin } from "@/lib/auth";
import { isUuid, writeOffSchema } from "@/lib/validation";
import { writeOffLot } from "@/lib/services/credit";
import { fail } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Crédito não encontrado." }, { status: 404 });

// Zera o saldo de um crédito (ex.: o dinheiro foi devolvido ao vizinho ou foi lançado por engano). Fica no histórico.
export async function POST(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return notFound();
  const p = writeOffSchema.safeParse(await req.json().catch(() => ({})));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const removed = await writeOffLot(id, p.data.note);
    return removed === null ? notFound() : Response.json({ ok: true, removedCents: removed });
  } catch (e) { return fail(e); }
}
