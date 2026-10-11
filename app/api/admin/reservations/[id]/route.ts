import { requireAdmin } from "@/lib/auth";
import { adminPatchSchema, isUuid } from "@/lib/validation";
import { getDetail, updateAdmin, softDelete } from "@/lib/services/admin";
import { fail } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };
const notFound = () => Response.json({ error: "Reserva não encontrada." }, { status: 404 });

export async function GET(_: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return notFound();
  const d = await getDetail(id); return d ? Response.json(d) : notFound();
}
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return notFound();
  const p = adminPatchSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try { return (await updateAdmin(id, p.data)) ? Response.json({ ok: true }) : notFound(); } catch (e) { return fail(e); }
}
export async function DELETE(_: Request, { params }: Ctx) {
  const denied = await requireAdmin(); if (denied) return denied;
  const id = (await params).id; if (!isUuid(id)) return notFound();
  return (await softDelete(id)) ? Response.json({ ok: true }) : notFound();
}
