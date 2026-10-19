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

/** Texto da cobrança: uma linha por reserva em aberto do apartamento, total e chave PIX (se houver). */
export function chargeMessage(name: string | null | undefined, items: ChargeItem[], pixKey?: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0];
  const total = items.reduce((s, i) => s + i.total_cents, 0);
  const lines = items.map((i) => `• ${fmtBR(i.start_at)} → ${fmtBR(i.end_at)}: ${brl(i.total_cents)}`);
  return [
    `Oi${first ? `, ${first}` : ""}! Tudo bem? Passando para lembrar do pagamento da garagem:`,
    "",
    ...lines,
    "",
    items.length > 1 ? `Total: ${brl(total)}` : `Valor: ${brl(total)}`,
    ...(pixKey ? [`Chave PIX: ${pixKey}`] : []),
    "",
    "Depois de pagar, dá para enviar o comprovante em \"Minhas reservas\" no site. Obrigado!",
  ].join("\n");
}
