import { requireAdmin } from "@/lib/auth";
import { getAdvanceDays, getChargeTemplate, getGarageName, getMaxUnpaid, getMonthlyCost, getPix, getPricing, getTimeStep, saveSettings, settingsHistory } from "@/lib/settings";
import { settingsSchema } from "@/lib/validation";

export async function GET() {
  return (await requireAdmin()) ?? Response.json({ pricing: await getPricing(), garageName: await getGarageName(), pix: await getPix(), maximumReservationAdvanceDays: await getAdvanceDays(), maxUnpaidReservations: await getMaxUnpaid(), chargeTemplate: await getChargeTemplate(), timeStepMinutes: await getTimeStep(), monthlyCost: await getMonthlyCost(), history: await settingsHistory() });
}
export async function PUT(req: Request) {
  const denied = await requireAdmin(); if (denied) return denied;
  const p = settingsSchema.safeParse(await req.json().catch(() => null));
  if (!p.success) return Response.json({ error: p.error.issues.find((i) => i.code === "custom")?.message ?? "Valores inválidos." }, { status: 400 });
  await saveSettings(p.data.pricing, p.data.garageName, p.data.maximumReservationAdvanceDays, p.data.pix, p.data.maxUnpaidReservations, p.data.chargeTemplate, p.data.timeStepMinutes, p.data.monthlyCost);
  return Response.json({ ok: true });
}
