import { requireAdmin } from "@/lib/auth";
import { getAdvanceDays, getGarageName, getPix, getPricing, saveSettings, settingsHistory } from "@/lib/settings";
import { settingsSchema } from "@/lib/validation";

export async function GET() {
  return (await requireAdmin()) ?? Response.json({ pricing: await getPricing(), garageName: await getGarageName(), pix: await getPix(), maximumReservationAdvanceDays: await getAdvanceDays(), history: await settingsHistory() });
}
export async function PUT(req: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  const p = settingsSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues.find((i) => i.code === "custom")?.message ?? "Valores inválidos." }, { status: 400 });
  await saveSettings(p.data.pricing, p.data.garageName, p.data.maximumReservationAdvanceDays, p.data.pix);
  return Response.json({ ok: true });
}
