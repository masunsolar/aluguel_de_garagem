"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export default function Login() {
  const [pwd, setPwd] = useState(""); const [err, setErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr("");
    try { await api("/api/admin/login", "POST", { password: pwd }); location.href = "/admin"; } catch (x) { setErr((x as Error).message); }
  }
  return (
    <form onSubmit={submit} className="mx-auto mt-24 max-w-xs space-y-3 px-4">
      <h1 className="text-2xl font-bold">Painel da garagem</h1>
      <input type="password" autoFocus placeholder="Senha" value={pwd} onChange={(e) => setPwd(e.target.value)} className="w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2.5" />
      {err && <p role="alert" className="text-ocupado">{err}</p>}
      <button className="w-full rounded-lg bg-asfalto px-4 py-3 text-white">Entrar</button>
    </form>
  );
}
