import { requireAdmin } from "@/lib/auth";
import { getAdvanceDays, getGarageName, getPricing, saveSettings, settingsHistory } from "@/lib/settings";
import { settingsSchema } from "@/lib/validation";

export async function GET() {
  return (await requireAdmin()) ?? Response.json({ pricing: await getPricing(), garageName: await getGarageName(), maximumReservationAdvanceDays: await getAdvanceDays(), history: await settingsHistory() });
}
export async function PUT(req: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  const p = settingsSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: "Valores inválidos." }, { status: 400 });
  await saveSettings(p.data.pricing, p.data.garageName, p.data.maximumReservationAdvanceDays);
  return Response.json({ ok: true });
}
