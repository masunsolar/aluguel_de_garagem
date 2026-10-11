import { getAdvanceDays, getPricing } from "@/lib/settings";
export const dynamic = "force-dynamic";
// Público: só o necessário para a tela de reserva (prévia de preço e janela de reserva).
export async function GET() { return Response.json({ pricing: await getPricing(), maximumReservationAdvanceDays: await getAdvanceDays() }); }
