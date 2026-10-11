import { brtInput, brtToDate, fmtBR } from "./time";
export class ApiError extends Error { conflicts: { id: string; label: string }[] = []; }
export async function api<T = any>(url: string, method = "GET", body?: unknown): Promise<T> {
  let r: Response;
  try { r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new ApiError("Sem conexão com o servidor. Verifique sua internet e tente de novo."); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && url.startsWith("/api/admin") && !url.endsWith("/login")) { location.href = "/admin/login"; throw new ApiError("Sessão expirada. Entre novamente."); }
  if (!r.ok) { const e = new ApiError(j.error ?? "Erro inesperado."); e.conflicts = j.conflicts ?? []; throw e; }
  return j as T;
}
export const toLocalInput = (iso: string) => brtInput(new Date(iso));
export const fromLocalInput = (v: string) => brtToDate(v.slice(0, 10), v.slice(11, 16)).toISOString();
export const fmtDT = fmtBR;
