import { requireAdmin } from "@/lib/auth";
import { quote } from "@/lib/services/admin";
import { quoteSchema } from "@/lib/validation";
import { fail } from "@/lib/errors";

export async function POST(req: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  const p = quoteSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Datas inválidas." }, { status: 400 });
  try { return Response.json(await quote(p.data.startAt, p.data.endAt)); } catch (e) { return fail(e); }
}
