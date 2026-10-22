import { requireAdmin } from "@/lib/auth";
import { adminCreditSchema } from "@/lib/validation";
import { creditOverview } from "@/lib/services/credit-requests";
import { createAdminCredit } from "@/lib/services/credit";
import { fail } from "@/lib/errors";

export const dynamic = "force-dynamic";
// Painel de créditos: pedidos (pendentes primeiro) e pessoas com saldo e extrato.
export async function GET() { return (await requireAdmin()) ?? Response.json(await creditOverview()); }
// Admin lança crédito para uma pessoa, sem precisar de reserva (ex.: PIX recebido). Devolve o pedido para anexar comprovante.
export async function POST(req: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  const p = adminCreditSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const { amountCents, note, ...who } = p.data;
    return Response.json(await createAdminCredit(who, amountCents, note), { status: 201 });
  } catch (e) { return fail(e); }
}
