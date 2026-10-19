// Cobrança pelo WhatsApp sem API paga: o painel monta um link wa.me com a mensagem pronta;
// o admin só confere e aperta "enviar" no próprio WhatsApp. Funções puras (navegador e testes).
import { brl } from "./pricing";
import { fmtBR } from "./time";

/** Só os dígitos; vazio se não parecer telefone. */
export const phoneDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Número no formato do wa.me (DDI + DDD + número). Sem DDI assume Brasil (55). */
export function waNumber(phone: string | null | undefined): string {
  const d = phoneDigits(phone);
  if (d.length === 10 || d.length === 11) return "55" + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return "";
}

/** Sem número válido, abre o WhatsApp para o admin escolher o contato (a mensagem vai junto). */
export function waLink(phone: string | null | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export type ChargeItem = { start_at: string; end_at: string; total_cents: number };

/** Marcadores que o admin pode usar no texto da cobrança (Configurações). */
export const CHARGE_PLACEHOLDERS = {
  "{nome}": "primeiro nome do responsável",
  "{reservas}": "uma linha por reserva em aberto (datas e valor)",
  "{total}": "soma das reservas em aberto",
  "{pix}": "sua chave PIX (a linha some se não houver chave)",
} as const;

export const DEFAULT_CHARGE_TEMPLATE = [
  "Oi, {nome}! Tudo bem? Passando para lembrar do pagamento da garagem:",
  "",
  "{reservas}",
  "",
  "Total: {total}",
  "Chave PIX: {pix}",
  "",
  "Depois de pagar, dá para enviar o comprovante em \"Minhas reservas\" no site. Obrigado!",
].join("\n");

/** Monta a cobrança a partir do modelo (o configurado no painel ou o padrão). */
export function chargeMessage(name: string | null | undefined, items: ChargeItem[], pixKey?: string, template?: string | null): string {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const total = items.reduce((s, i) => s + i.total_cents, 0);
  const reservas = items.map((i) => `• ${fmtBR(i.start_at)} → ${fmtBR(i.end_at)}: ${brl(i.total_cents)}`).join("\n");
  const pix = (pixKey ?? "").trim();
  const tpl = template?.trim() ? template : DEFAULT_CHARGE_TEMPLATE;
  return tpl
    .split("\n")
    .filter((line) => pix || !line.includes("{pix}")) // sem chave PIX: some a linha inteira, não fica "Chave PIX: "
    .join("\n")
    .replace(first ? /\{nome\}/g : /,?[ \t]*\{nome\}/g, () => first) // sem nome: "Oi, {nome}!" vira "Oi!"
    .replaceAll("{reservas}", () => reservas) // função: "$" vindo de nomes/valores não vira padrão de substituição
    .replaceAll("{total}", () => brl(total))
    .replaceAll("{pix}", () => pix)
    .trim();
}
