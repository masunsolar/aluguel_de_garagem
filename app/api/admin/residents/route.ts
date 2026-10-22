import { requireAdmin } from "@/lib/auth";
import { listResidents } from "@/lib/services/admin";

export const dynamic = "force-dynamic";
// Moradores que já usaram a garagem (montado a partir das reservas). Só admin: tem nome, placa e WhatsApp.
export async function GET() { return (await requireAdmin()) ?? Response.json(await listResidents()); }
