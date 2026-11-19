"use client";
import { useState } from "react";
import { api } from "@/lib/client";

export default function Login() {
  const [pwd, setPwd] = useState(""); const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (loading) return; setErr(""); setLoading(true);
    try { await api("/api/admin/login", "POST", { password: pwd }); location.href = "/admin"; } catch (x) { setErr((x as Error).message); setLoading(false); } // no sucesso fica "Entrando…" até a página trocar
  }
  return (
    <form onSubmit={submit} aria-busy={loading} className="mx-auto mt-24 max-w-xs space-y-3 px-4">
      <h1 className="text-2xl font-bold">Painel da garagem</h1>
      <input type="password" autoFocus disabled={loading} placeholder="Senha" value={pwd} onChange={(e) => setPwd(e.target.value)} className="w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2.5" />
      {err && <p role="alert" className="text-ocupado">{err}</p>}
      <button disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-asfalto px-4 py-3 text-white disabled:cursor-wait disabled:opacity-70">
        {loading && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}{loading ? "Entrando…" : "Entrar"}</button>
    </form>
  );
}
