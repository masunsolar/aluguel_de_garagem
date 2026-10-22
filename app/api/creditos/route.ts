import { neighborCreditIds, neighborIds, rememberCreditRequest } from "@/lib/auth";
import { creditRequestSchema } from "@/lib/validation";
import { createRequest, listMineRequests } from "@/lib/services/credit-requests";
import { ledgerFor, sessionOwner, sumLots, lotsFor } from "@/lib/services/credit";
import { limited, tooMany } from "@/lib/ratelimit";
import { fail } from "@/lib/errors";

export const dynamic = "force-dynamic";

// "Meu crédito": pedidos deste aparelho + saldo e extrato da pessoa CONFIRMADA neste aparelho
// (reserva paga ou pedido confirmado). Quem só digitou os dados de outro vizinho não vê nada dele.
export async function GET() {
  const ids = await neighborIds(), crs = await neighborCreditIds();
  const owner = await sessionOwner(ids, crs);
  const requests = await listMineRequests(crs);
  if (!owner) return Response.json({ owner: null, balanceCents: 0, movements: [], requests });
  return Response.json({ owner: { name: owner.name }, balanceCents: sumLots(await lotsFor(owner)), movements: await ledgerFor(owner), requests });
}

// Vizinho avisa que mandou um valor (PIX). Vira crédito só quando o admin confirmar.
export async function POST(req: Request) {
  if (await limited(req, "pedido-credito", 5, 3600)) return tooMany();
  const body = await req.json().catch(() => null);
  if (body && typeof body.website === "string" && body.website !== "") return Response.json({ id: "00000000-0000-0000-0000-000000000000" }, { status: 201 }); // robô
  const p = creditRequestSchema.safeParse(body);
  if (!p.success) return Response.json({ error: p.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  try {
    const id = await createRequest(p.data);
    await rememberCreditRequest(id);
    return Response.json({ id }, { status: 201 });
  } catch (e) { return fail(e); }
}
