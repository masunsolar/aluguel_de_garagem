import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// 1ª barreira: nada de /admin ou /api/admin passa sem sessão de admin válida.
// (Cada rota ainda confere de novo com requireAdmin — defesa em profundidade.)
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/admin/login" || pathname === "/api/admin/login") return NextResponse.next();
  const t = req.cookies.get("adm")?.value;
  if (t) {
    try { await jwtVerify(t, new TextEncoder().encode(process.env.AUTH_SECRET!), { audience: "admin" }); return NextResponse.next(); } catch {}
  }
  return pathname.startsWith("/api/")
    ? NextResponse.json({ error: "Não autorizado." }, { status: 401 })
    : NextResponse.redirect(new URL("/admin/login", req.url));
}
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
