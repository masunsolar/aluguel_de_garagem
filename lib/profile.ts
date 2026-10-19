// "Lembrar meus dados": nome, apto, WhatsApp e último veículo ficam SÓ neste aparelho (localStorage).
// Nada vai para o servidor além do que já é enviado na reserva. Sem localStorage (aba anônima,
// bloqueio do navegador), tudo continua funcionando, só não lembra.
export type Profile = { name: string; apartment: string; phone: string; carBrand: string; carModel: string; carColor: string; plate: string };

const KEY = "garagem:meus-dados:v1";
const FIELDS: (keyof Profile)[] = ["name", "apartment", "phone", "carBrand", "carModel", "carColor", "plate"];

export function loadProfile(): Profile | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return null;
    const p = Object.fromEntries(FIELDS.map((k) => [k, typeof v[k] === "string" ? v[k].slice(0, 80) : ""])) as Profile;
    return p.name || p.apartment ? p : null;
  } catch { return null; }
}
export function saveProfile(f: Profile) {
  try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, (f[k] ?? "").trim()])))); } catch {}
}
export function clearProfile() {
  try { localStorage.removeItem(KEY); } catch {}
}
