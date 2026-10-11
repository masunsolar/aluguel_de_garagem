import { getAdvanceDays, getPix, getPricing } from "@/lib/settings";
export const dynamic = "force-dynamic";
// Público: só o necessário para a tela de reserva (preço, janela e a chave PIX, que é feita para ser divulgada ao pagador).
export async function GET() { return Response.json({ pricing: await getPricing(), maximumReservationAdvanceDays: await getAdvanceDays(), pix: await getPix() }); }
