import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { json, sql } from "./db";

// Duas sessões totalmente separadas: cookie "adm" (aud=admin) e cookie "viz" (aud=neighbor).
const key = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET ausente ou com menos de 32 caracteres.");
  return new TextEncoder().encode(s);
};
export const hashCode = (v: string) => createHash("sha256").update(v).digest("hex");

/** Senha do admin: hash scrypt com salt aleatório em ADMIN_PASSWORD_HASH (gere com scripts/hash-password.mjs). */
export function checkPassword(p: string): boolean {
  const [alg, salt, hash] = (process.env.ADMIN_PASSWORD_HASH ?? "").split(":");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = scryptSync(p, Buffer.from(salt, "base64url"), want.length);
  return got.length === want.length && timingSafeEqual(got, want);
}

const sign = (aud: string, payload: Record<string, unknown>, exp: string) =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setAudience(aud).setExpirationTime(exp).sign(key());
async function read(name: string, aud: string) {
  const t = (await cookies()).get(name)?.value;
  if (!t) return null;
  try { return (await jwtVerify(t, key(), { audience: aud })).payload; } catch { return null; }
}
const opts = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge });

// Sessão revogável: o token carrega a "época" da sessão; o logout incrementa a época no banco e invalida
// imediatamente todos os tokens emitidos antes (o middleware só confere a assinatura; as rotas conferem a época).
async function epoch(): Promise<number> {
  const r = await sql`select value from settings where key = 'admin_epoch'`;
  return Number(json(r[0]?.value ?? 0)) || 0;
}
export async function createAdminSession() { (await cookies()).set("adm", await sign("admin", { v: await epoch() }, "1d"), opts(86400)); }
export async function isAdmin() {
  const p = await read("adm", "admin");
  return !!p && p.v === (await epoch());
}
export async function destroyAdminSession() {
  if (await isAdmin()) // quem não está logado não consegue "deslogar" o admin
    await sql`insert into settings (key, value) values ('admin_epoch', '1'::jsonb)
              on conflict (key) do update set value = to_jsonb((settings.value #>> '{}')::int + 1)`;
  (await cookies()).delete("adm");
}
/** Toda rota admin chama isto. Retorna uma Response 401 se não for admin. */
export async function requireAdmin(): Promise<Response | null> {
  return (await isAdmin()) ? null : Response.json({ error: "Não autorizado." }, { status: 401 });
}

// Cookie "viz": ids das reservas (ids) e dos pedidos de crédito (crs) feitos neste navegador.
async function neighborSession(): Promise<{ ids: string[]; crs: string[] }> {
  const p = await read("viz", "neighbor");
  const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === "string") : []);
  return { ids: list(p?.ids), crs: list(p?.crs) };
}
export async function neighborIds(): Promise<string[]> { return (await neighborSession()).ids; }
export async function neighborCreditIds(): Promise<string[]> { return (await neighborSession()).crs; }
async function saveNeighbor(s: { ids: string[]; crs: string[] }) {
  (await cookies()).set("viz", await sign("neighbor", { ids: s.ids.slice(0, 50), crs: s.crs.slice(0, 50) }, "30d"), opts(2592000));
}
export async function rememberReservation(id: string) {
  const s = await neighborSession(); await saveNeighbor({ ...s, ids: [...new Set([id, ...s.ids])] });
}
export async function rememberCreditRequest(id: string) {
  const s = await neighborSession(); await saveNeighbor({ ...s, crs: [...new Set([id, ...s.crs])] });
}
