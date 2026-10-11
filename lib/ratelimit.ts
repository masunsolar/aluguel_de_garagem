import "server-only";
import { sql } from "./db";

// Limite por IP em janela fixa, guardado no Postgres (funciona em serverless, onde memória não é compartilhada).
// Na Vercel, x-forwarded-for é definido pela própria plataforma (o cliente não consegue forjar).
const ip = (req: Request) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconhecido";

export async function limited(req: Request, bucket: string, max: number, windowSec: number, perIp = true): Promise<boolean> {
  const key = `${bucket}:${perIp ? ip(req) : "global"}`;
  const r = await sql`insert into rate_limits (key, window_start, hits)
    values (${key}, to_timestamp(floor(extract(epoch from now()) / ${windowSec}::int) * ${windowSec}::int), 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1 returning hits`;
  if (Math.random() < 0.02) await sql`delete from rate_limits where window_start < now() - interval '2 days'`;
  return Number(r[0].hits) > max;
}
export const tooMany = () => Response.json({ error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." }, { status: 429 });
