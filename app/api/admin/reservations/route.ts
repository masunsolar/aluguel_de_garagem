import { requireAdmin } from "@/lib/auth";
import { adminCreateSchema } from "@/lib/validation";
import { createAdmin, listAll } from "@/lib/services/admin";
import { fail } from "@/lib/errors";

export async function GET() { return (await requireAdmin()) ?? Response.json(await listAll()); }
export async function POST(req: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  const p = adminCreateSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try { return Response.json({ id: await createAdmin(p.data) }, { status: 201 }); } catch (e) { return fail(e); }
}
