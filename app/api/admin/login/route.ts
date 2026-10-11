import { checkPassword, createAdminSession, destroyAdminSession } from "@/lib/auth";
import { limited, tooMany } from "@/lib/ratelimit";

export async function POST(req: Request) {
  // anti força-bruta: 5 tentativas / 15 min por IP, e 40 / hora no total (contra ataques distribuídos)
  if ((await limited(req, "login", 5, 900)) || (await limited(req, "login-all", 40, 3600, false))) return tooMany();
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (typeof password !== "string" || password.length > 200 || !checkPassword(password)) return Response.json({ error: "Senha incorreta." }, { status: 401 });
  await createAdminSession();
  return Response.json({ ok: true });
}
export async function DELETE() { await destroyAdminSession(); return Response.json({ ok: true }); }
