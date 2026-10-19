"use client";
import { useEffect, useMemo, useState } from "react";
import MyReservations from "./MyReservations";
import PixBox from "./PixBox";
import PriceBreakdown from "./PriceBreakdown";
import type { PixConfig } from "@/lib/pix";
import { calculatePrice, brl, toDate, withDefaults, DEFAULT_PRICING, type PricingConfig, type PriceBreakdown as Breakdown } from "@/lib/pricing";
import { brtDay } from "@/lib/time";

type Busy = { start: string; end: string };
const iso = brtDay;
const hm = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const field = "w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2.5";

export default function Booking() {
  const today = iso(new Date());
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [pix, setPix] = useState<PixConfig | null>(null);
  const [advance, setAdvance] = useState(14); // maximumReservationAdvanceDays (vem do servidor)
  const [loadErr, setLoadErr] = useState(false);
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState(false);
  const [ver, setVer] = useState(0);
  const [done, setDone] = useState<{ id: string; code: string; start: string; end: string; totalCents: number; breakdown: Breakdown | null } | null>(null);

  const load = () => fetch("/api/availability").then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => { setBusy(b); setLoadErr(false); }).catch(() => setLoadErr(true));
  useEffect(() => {
    load();
    fetch("/api/config").then((r) => r.json()).then((c) => { setPricing(withDefaults(c.pricing)); setAdvance(c.maximumReservationAdvanceDays); setPix(c.pix ?? null); }).catch(() => {});
  }, []);

  const days = useMemo(() => Array.from({ length: advance + 1 }, (_, i) => iso(new Date(Date.now() + i * 86400000))), [advance]);
  const overlaps = (d: string) => (busy ?? []).filter((b) => new Date(b.start) < toDate(d, "23:59") && new Date(b.end) > toDate(d, "00:00"));
  const dayBusy = overlaps(day);

  if (done) return (
    <div className="mt-6 rounded-2xl bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-livre">Reserva realizada com sucesso!</h2>
      <dl className="mt-4 space-y-1">
        <div>Entrada: {new Date(done.start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</div>
        <div>Saída: {new Date(done.end).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</div>
        <div>Valor: <b>{brl(done.totalCents)}</b></div>
        <PriceBreakdown breakdown={done.breakdown} className="mt-2 rounded-lg bg-concreto p-3" />
        <div>Identificador: <b>{done.id}</b></div>
        <div className="mt-2 rounded-lg bg-concreto p-3 text-sm">Código para acompanhar em outro aparelho: <b className="select-all">{done.code}</b><br />Guarde-o: ele não será mostrado de novo.</div>
      </dl>
      <PixBox pix={pix} totalCents={done.totalCents} />
      <p className="mt-3 rounded-lg bg-faixa/20 p-3 text-sm">Pagamento <b>pendente</b>. Depois de pagar, envie o comprovante em <b>“Minhas reservas”</b> (foto da tela ou PDF).</p>
      <button className="mt-5 rounded-lg bg-asfalto px-4 py-2.5 text-white" onClick={() => { setDone(null); setOpen(false); setVer((v) => v + 1); load(); }}>Voltar</button>
    </div>
  );

  return (
    <>
      <div className="mt-6 flex gap-2 overflow-x-auto pb-2" role="tablist" aria-label="Dias">
        {days.map((d) => {
          const taken = overlaps(d).length > 0, sel = d === day;
          return (
            <button key={d} role="tab" aria-selected={sel} onClick={() => setDay(d)}
              className={`min-w-16 shrink-0 rounded-xl border px-3 py-2 text-center ${sel ? "border-asfalto bg-asfalto text-white" : "border-asfalto/15 bg-white"}`}>
              <div className="text-xs">{new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short" })}</div>
              <div className="text-lg font-semibold">{d.slice(8)}</div>
              <div className={`mx-auto mt-1 h-1.5 w-1.5 rounded-full ${taken ? "bg-ocupado" : "bg-livre"}`} />
            </button>
          );
        })}
      </div>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm" aria-live="polite">
        {loadErr ? <div role="alert" className="text-ocupado">Não foi possível carregar a disponibilidade. <button onClick={() => { setLoadErr(false); load(); }} className="underline">Tentar de novo</button></div> : busy === null ? <p className="animate-pulse text-asfalto/60">Carregando disponibilidade…</p> : dayBusy.length === 0 ? (
          <p><span className="mr-2 inline-block h-3 w-3 rounded-full bg-livre" />Disponível o dia todo</p>
        ) : (
          <ul className="space-y-2">
            {dayBusy.map((b, i) => (
              <li key={i}><span className="mr-2 inline-block h-3 w-3 rounded-full bg-ocupado" />Ocupado: {hm(b.start)} até {hm(b.end)}{iso(new Date(b.end)) !== day ? " (dia seguinte)" : ""}</li>
            ))}
            <li className="text-sm text-asfalto/60"><span className="mr-2 inline-block h-3 w-3 rounded-full bg-livre" />Fora desses horários: disponível</li>
          </ul>
        )}
      </section>

      <p className="mt-4 text-sm text-asfalto/70">🕥 Check-out até <b>{pricing.checkoutTime}</b>: quem pernoita e sai até esse horário não paga a manhã.</p>
      <button onClick={() => setOpen(true)} className="mt-3 w-full rounded-xl bg-faixa px-4 py-3.5 text-lg font-semibold text-asfalto shadow-sm">+ Fazer reserva</button>
      {open && <Form day={day} pricing={pricing} maxDate={days[days.length - 1]} onClose={() => setOpen(false)} onDone={setDone} />}
      <MyReservations key={ver} />
    </>
  );
}

function Form({ day, pricing, maxDate, onClose, onDone }: { day: string; pricing: PricingConfig; maxDate: string; onClose: () => void; onDone: (r: any) => void }) {
  const [f, setF] = useState({ startDate: day, startTime: "18:00", endDate: day, endTime: "23:00", name: "", apartment: "", carBrand: "", carModel: "", carColor: "", plate: "", phone: "", website: "" });
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { setErr(""); setF({ ...f, [k]: e.target.value }); }; // limpa o erro anterior ao editar

  let quote: ReturnType<typeof calculatePrice> | null = null;
  try { quote = calculatePrice(toDate(f.startDate, f.startTime), toDate(f.endDate, f.endTime), pricing); } catch {}

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/reservations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) onDone(j); else setErr(j.error ?? "Não foi possível reservar. Tente novamente.");
    } catch { setErr("Sem conexão com o servidor. Verifique sua internet e tente de novo."); }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-asfalto/60 sm:items-center" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl">
        {/* Só o miolo rola; o rodapé fica fora da rolagem e nunca cobre o conteúdo (dvh = altura real no celular) */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5">
          <h2 className="text-xl font-bold">Nova reserva</h2>
          <div className="grid grid-cols-2 gap-3">
            <label>Entrada<input className={field} type="date" min={brtDay(new Date())} max={maxDate} value={f.startDate} onChange={set("startDate")} required /></label>
            <label>Hora<input className={field} type="time" value={f.startTime} onChange={set("startTime")} required /></label>
            <label>Saída<input className={field} type="date" min={f.startDate} value={f.endDate} onChange={set("endDate")} required /></label>
            <label>Hora<input className={field} type="time" value={f.endTime} onChange={set("endTime")} required /></label>
          </div>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set("website")} className="absolute -left-[9999px]" />
          <label className="block">Nome do responsável<input className={field} value={f.name} onChange={set("name")} required /></label>
          <div className="grid grid-cols-2 gap-3">
            <label>Apartamento<input className={field} value={f.apartment} onChange={set("apartment")} required /></label>
            <label>Placa<input className={field} value={f.plate} onChange={(e) => { setErr(""); setF({ ...f, plate: e.target.value.toUpperCase() }); }} maxLength={8} placeholder="ABC1D23" required /></label>
            <label>Marca<input className={field} value={f.carBrand} onChange={set("carBrand")} required /></label>
            <label>Modelo<input className={field} value={f.carModel} onChange={set("carModel")} required /></label>
            <label>Cor<input className={field} value={f.carColor} onChange={set("carColor")} required /></label>
            <label>WhatsApp <span className="text-asfalto/60">(opcional)</span><input className={field} type="tel" inputMode="tel" autoComplete="tel" maxLength={25} value={f.phone} onChange={set("phone")} placeholder="(43) 99999-8888" /></label>
          </div>
          <div className="rounded-xl bg-concreto p-4">
            {quote ? <>
              <div>Tempo total: {Math.floor(quote.minutes / 60)}h{String(quote.minutes % 60).padStart(2, "0")}</div>
              <div className="text-2xl font-bold">{brl(quote.totalCents)}</div>
              <PriceBreakdown breakdown={quote.breakdown} className="mt-2" />
            </> : <span className="text-ocupado">A saída precisa ser depois da entrada.</span>}
          </div>
          <p className="text-sm text-asfalto/70">Check-out até <b>{pricing.checkoutTime}</b>. Pernoitou e saiu até esse horário? A manhã não é cobrada.</p>
        </div>
        {err && <p role="alert" className="mx-5 mb-2 max-h-32 shrink-0 overflow-y-auto rounded-lg bg-ocupado/10 p-3 text-ocupado">{err}</p>}
        <div className="flex shrink-0 gap-3 border-t border-asfalto/10 bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-asfalto/20 px-4 py-3">Cancelar</button>
          <button disabled={loading || !quote} className="flex-1 rounded-lg bg-asfalto px-4 py-3 font-semibold text-white disabled:opacity-50">{loading ? "Reservando…" : "Confirmar reserva"}</button>
        </div>
      </form>
    </div>
  );
}
