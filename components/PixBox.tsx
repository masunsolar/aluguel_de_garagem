"use client";
import { useState } from "react";
import { brl } from "@/lib/pricing";
import { pixPayload, type PixConfig } from "@/lib/pix";

function Copy({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); } catch { window.prompt("Copie:", text); }
  }
  return <button type="button" onClick={copy} className="rounded-lg border border-asfalto/20 bg-white px-3 py-1.5 text-sm">{ok ? "Copiado!" : label}</button>;
}

export default function PixBox({ pix, totalCents }: { pix: PixConfig | null; totalCents: number }) {
  if (!pix?.key) return null;
  const code = pixPayload(pix, totalCents);
  return (
    <div className="mt-4 rounded-xl border border-livre/40 bg-concreto p-4 text-sm">
      <div className="font-semibold">Pagamento via PIX — {brl(totalCents)}</div>
      <div className="mt-2">Chave PIX{pix.name ? ` (${pix.name})` : ""}:</div>
      <div className="mt-1 flex flex-wrap items-center gap-2"><b className="select-all break-all">{pix.key}</b><Copy text={pix.key} label="Copiar chave" /></div>
      {code && <div className="mt-3"><div>Ou use o PIX copia e cola, já com o valor:</div><div className="mt-1"><Copy text={code} label="Copiar PIX copia e cola" /></div></div>}
      <p className="mt-3 text-asfalto/70">Depois de pagar, o administrador confirma o recebimento.</p>
    </div>
  );
}
