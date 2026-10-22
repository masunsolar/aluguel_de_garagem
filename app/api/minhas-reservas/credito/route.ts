import { neighborIds } from "@/lib/auth";
import { sessionBalance } from "@/lib/services/credit";

export const dynamic = "force-dynamic";
// Saldo de crédito de quem usa este aparelho (pela reserva mais recente da SUA sessão assinada). Só o valor: nada pessoal.
export async function GET() { return Response.json({ creditCents: await sessionBalance(await neighborIds()) }); }
