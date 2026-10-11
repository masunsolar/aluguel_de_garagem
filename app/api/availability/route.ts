export const dynamic = "force-dynamic";
import { getBusy } from "@/lib/services/public";
export async function GET() { return Response.json(await getBusy()); }
