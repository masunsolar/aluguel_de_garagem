"use client";
import { useEffect, useState } from "react";
import { api, fmtDT } from "@/lib/client";
import { CHARGE_PLACEHOLDERS, DEFAULT_CHARGE_TEMPLATE, chargeMessage } from "@/lib/whatsapp";

// Exemplo só para a prévia da mensagem (não é gravado)
const SAMPLE = [{ start_at: "2026-10-18T21:00:00Z", end_at: "2026-10-19T12:00:00Z", total_cents: 1500 }, { start_at: "2026-10-20T09:00:00Z", end_at: "2026-10-20T21:00:00Z", total_cents: 3000 }];

const input = "mt-1 block w-28 rounded-lg border border-asfalto/20 bg-white px-3 py-2";
export default function Settings() {
  const [s, setS] = useState<any>(null); const [msg, setMsg] = useState("");
  useEffect(() => { api("/api/admin/settings").then(setS); }, []);
  if (!s) return null;
  const num = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, pricing: { ...s.pricing, [k]: Number(e.target.value) } });
  const setPix = (k: string, v: string) => setS({ ...s, pix: { ...(s.pix ?? { key: "", name: "", city: "" }), [k]: v } });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const tpl = (s.chargeTemplate ?? "").trim();
    const body = { ...s, chargeTemplate: tpl === DEFAULT_CHARGE_TEMPLATE ? "" : tpl }; // igual ao padrão = segue o padrão
    try { await api("/api/admin/settings", "PUT", body); setMsg("Configurações salvas."); } catch (x) { setMsg((x as Error).message); }
  }
  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4">
      <label>Antecedência máx. (dias)<input type="number" min={1} max={60} className={input} value={s.maximumReservationAdvanceDays} onChange={(e) => setS({ ...s, maximumReservationAdvanceDays: Number(e.target.value) })} /></label>
      <label>Bloquear com mais de (pendências)<input type="number" min={0} max={50} className={input} value={s.maxUnpaidReservations ?? ""} placeholder="desligado" onChange={(e) => setS({ ...s, maxUnpaidReservations: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <p className="w-full text-xs text-asfalto/60">O apartamento com mais pendências que isso não consegue fazer novas reservas. Contam só reservas já usadas, não pagas e sem comprovante enviado. 1 = bloqueia a partir da 2ª; 0 = bloqueia com qualquer pendência; vazio = desligado. Reservas manuais suas não são bloqueadas.</p>
      <label className="w-full">Nome da garagem<input className="mt-1 block w-full max-w-sm rounded-lg border border-asfalto/20 px-3 py-2" value={s.garageName} onChange={(e) => setS({ ...s, garageName: e.target.value })} /></label>
      {([["dayPrice", "Dia (R$)"], ["nightPrice", "Noite (R$)"], ["dayStartHour", "Dia começa (h)"], ["nightStartHour", "Noite começa (h)"]] as const).map(([k, l]) => (
        <label key={k}>{l}<input type="number" step="0.01" className={input} value={s.pricing[k]} onChange={num(k)} /></label>
      ))}
      <label>Check-out até<input type="time" className={input} value={s.pricing.checkoutTime ?? "10:30"} onChange={(e) => setS({ ...s, pricing: { ...s.pricing, checkoutTime: e.target.value } })} /></label>
      <p className="w-full text-xs text-asfalto/60">Quem pernoita e sai até o check-out não paga a manhã. O dia continua começando no horário acima. Para desligar, use o mesmo horário do início do dia.</p>
      <fieldset className="w-full rounded-lg border border-asfalto/15 p-3">
        <legend className="px-1 text-sm">PIX para pagamento (vizinhos veem esta chave)</legend>
        <div className="flex flex-wrap gap-3">
          <label className="w-full max-w-sm">Chave PIX<input className="mt-1 block w-full rounded-lg border border-asfalto/20 px-3 py-2" maxLength={77} value={s.pix?.key ?? ""} onChange={(e) => setPix("key", e.target.value)} placeholder="CPF, e-mail, telefone (+55...) ou chave aleatória" /></label>
          <label>Nome do recebedor<input className="mt-1 block w-56 rounded-lg border border-asfalto/20 px-3 py-2" maxLength={25} value={s.pix?.name ?? ""} onChange={(e) => setPix("name", e.target.value)} /></label>
          <label>Cidade<input className="mt-1 block w-40 rounded-lg border border-asfalto/20 px-3 py-2" maxLength={15} value={s.pix?.city ?? ""} onChange={(e) => setPix("city", e.target.value)} /></label>
        </div>
        <p className="mt-2 text-xs text-asfalto/60">Com nome e cidade preenchidos, o vizinho também recebe o "copia e cola" com o valor da reserva. Deixe a chave vazia para não exibir PIX.</p>
      </fieldset>
      <fieldset className="w-full rounded-lg border border-asfalto/15 p-3">
        <legend className="px-1 text-sm">Mensagem de cobrança (botão "Cobrar no WhatsApp")</legend>
        <div className="grid gap-3 lg:grid-cols-2">
          <label className="block">Texto
            <textarea rows={10} maxLength={1500} className="mt-1 block w-full rounded-lg border border-asfalto/20 px-3 py-2 font-mono text-sm" value={s.chargeTemplate || DEFAULT_CHARGE_TEMPLATE} onChange={(e) => setS({ ...s, chargeTemplate: e.target.value })} />
          </label>
          <div>
            <div>Prévia (exemplo)</div>
            <pre className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-concreto p-3 font-sans text-sm">{chargeMessage("Karina Silva", SAMPLE, s.pix?.key, s.chargeTemplate)}</pre>
          </div>
        </div>
        <ul className="mt-2 space-y-0.5 text-xs text-asfalto/70">
          {Object.entries(CHARGE_PLACEHOLDERS).map(([k, v]) => <li key={k}><code className="rounded bg-concreto px-1">{k}</code> {v}</li>)}
        </ul>
        <button type="button" onClick={() => setS({ ...s, chargeTemplate: "" })} className="mt-2 text-sm underline">Restaurar texto padrão</button>
        <p className="mt-1 text-xs text-asfalto/60">Você ainda pode ajustar a mensagem no WhatsApp antes de enviar.</p>
      </fieldset>
      <button className="rounded-lg bg-asfalto px-4 py-2.5 text-white">Salvar</button>
      {msg && <span role="status">{msg}</span>}
      {s.history?.length > 0 && <details className="w-full text-sm"><summary className="cursor-pointer">Histórico de alterações</summary><ul className="mt-1 space-y-1">{s.history.map((h: any, i: number) => <li key={i}>{fmtDT(h.created_at)} — {({ pricing: "preços/check-out", pix: "PIX", booking: "reservas", charge_template: "mensagem de cobrança" } as Record<string, string>)[h.details.chave] ?? "nome"}: {JSON.stringify(h.details.de)} → {JSON.stringify(h.details.para)}</li>)}</ul></details>}
    </form>
  );
}
