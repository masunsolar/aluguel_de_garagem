"use client";
import { clearProfile, loadProfile, saveProfile } from "@/lib/profile";
import { useEffect, useMemo, useState } from "react";
import MyReservations from "./MyReservations";
import MyCredit from "./MyCredit";
import PixBox from "./PixBox";
import PriceBreakdown from "./PriceBreakdown";
import DayBar from "./DayBar";
import type { PixConfig } from "@/lib/pix";
import { calculatePrice, brl, toDate, withDefaults, DEFAULT_PRICING, type PricingConfig, type PriceBreakdown as Breakdown } from "@/lib/pricing";
import { brtDay, fmtBR } from "@/lib/time";
import { DEFAULT_TIME_STEP, isFriday, preset, timeOptions, type PresetKind } from "@/lib/timeslots";

type Busy = { start: string; end: string };
const iso = brtDay;
const hm = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
// "23/10 08:00 até 12:00" (mesmo dia) ou "23/10 19:00 até 24/10 10:00"
const span = (a: string, b: string) => { const x = fmtBR(a), y = fmtBR(b); return x.slice(0, 10) === y.slice(0, 10) ? `${x.slice(0, 5)} ${x.slice(-5)} até ${y.slice(-5)}` : `${x.slice(0, 5)} ${x.slice(-5)} até ${y.slice(0, 5)} ${y.slice(-5)}`; };
const field = "w-full rounded-lg border border-asfalto/20 bg-white px-3 py-2.5";

export default function Booking() {
  const today = iso(new Date());
  const [busy, setBusy] = useState<Busy[] | null>(null);
  const [pricing, setPricing] = useState<PricingConfig>(DEFAULT_PRICING);
  const [pix, setPix] = useState<PixConfig | null>(null);
  const [step, setStep] = useState<number>(DEFAULT_TIME_STEP); // de quantos em quantos minutos (vem do servidor)
  const [advance, setAdvance] = useState(14); // maximumReservationAdvanceDays (vem do servidor)
  const [loadErr, setLoadErr] = useState(false);
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState(false);
  const [ver, setVer] = useState(0);
  const [done, setDone] = useState<{ id: string; code: string; start: string; end: string; totalCents: number; breakdown: Breakdown | null; creditUsedCents?: number; paymentStatus?: string } | null>(null);

  const load = () => fetch("/api/availability").then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => { setBusy(b); setLoadErr(false); }).catch(() => setLoadErr(true));
  useEffect(() => {
    load();
    fetch("/api/config").then((r) => r.json()).then((c) => { setPricing(withDefaults(c.pricing)); setAdvance(c.maximumReservationAdvanceDays); setPix(c.pix ?? null); if (c.timeStepMinutes) setStep(c.timeStepMinutes); }).catch(() => {});
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
        {!!done.creditUsedCents && <div className="text-livre">Crédito usado: <b>− {brl(done.creditUsedCents)}</b> • A pagar: <b>{brl(done.totalCents - done.creditUsedCents)}</b></div>}
        <PriceBreakdown breakdown={done.breakdown} className="mt-2 rounded-lg bg-concreto p-3" />
        <div>Identificador: <b>{done.id}</b></div>
        <div className="mt-2 rounded-lg bg-concreto p-3 text-sm">Código para acompanhar em outro aparelho: <b className="select-all">{done.code}</b><br />Guarde-o: ele não será mostrado de novo.</div>
      </dl>
      {done.paymentStatus === "pago"
        ? <p className="mt-3 rounded-lg bg-livre/10 p-3 text-sm">Pagamento <b>confirmado com o seu crédito</b>. Não precisa pagar nada agora.</p>
        : <>
          <PixBox pix={pix} totalCents={done.totalCents - (done.creditUsedCents ?? 0)} />
          <p className="mt-3 rounded-lg bg-faixa/20 p-3 text-sm">Pagamento <b>pendente</b>. Depois de pagar, envie o comprovante em <b>“Minhas reservas”</b> (foto da tela ou PDF).</p>
        </>}
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
        {busy !== null && !loadErr && <DayBar day={day} busy={dayBusy} />}
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
      {open && <Form day={day} pricing={pricing} step={step} busy={busy ?? []} maxDate={days[days.length - 1]} onClose={() => setOpen(false)} onDone={setDone} />}
      <MyCredit key={`c${ver}`} />
      <MyReservations key={ver} />
    </>
  );
}

function Form({ day, pricing, step, busy, maxDate, onClose, onDone }: { day: string; pricing: PricingConfig; step: number; busy: Busy[]; maxDate: string; onClose: () => void; onDone: (r: any) => void }) {
  const EMPTY = { name: "", apartment: "", carBrand: "", carModel: "", carColor: "", plate: "", phone: "" };
  const [saved] = useState(loadProfile); // o formulário só abre no navegador (após o clique), então dá para ler aqui
  const [f, setF] = useState({ startDate: day, startTime: "18:00", endDate: day, endTime: "23:00", ...EMPTY, ...(saved ?? {}), website: "" });
  const [remember, setRemember] = useState(true); const [prefilled, setPrefilled] = useState(!!saved);
  const [err, setErr] = useState(""); const [loading, setLoading] = useState(false);
  const [credit, setCredit] = useState(0); // crédito de quem usa este aparelho; o servidor decide quanto abate de verdade
  useEffect(() => { fetch("/api/minhas-reservas/credito").then((r) => r.json()).then((c) => setCredit(Number(c.creditCents) || 0)).catch(() => {}); }, []);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setErr(""); setF({ ...f, [k]: e.target.value }); }; // limpa o erro anterior ao editar

  // horários de N em N minutos; o check-out e os valores já escolhidos sempre aparecem na lista
  const opts = useMemo(() => timeOptions(step, [pricing.checkoutTime, f.startTime, f.endTime]), [step, pricing.checkoutTime, f.startTime, f.endTime]);

  // atalhos com os horários configurados no painel (preço calculado pela mesma regra do servidor)
  const kinds: PresetKind[] = isFriday(f.startDate) ? ["dia", "pernoite", "fimdesemana"] : ["dia", "pernoite"];
  const presets = kinds.map((k) => {
    const p = preset(k, f.startDate, pricing, step);
    let cents: number | null = null;
    try { if (p) cents = calculatePrice(toDate(p.startDate, p.startTime), toDate(p.endDate, p.endTime), pricing).totalCents; } catch {}
    return { k, p, cents };
  });

  let quote: ReturnType<typeof calculatePrice> | null = null;
  try { quote = calculatePrice(toDate(f.startDate, f.startTime), toDate(f.endDate, f.endTime), pricing); } catch {}
  // Conflito com reservas já existentes (intervalo [): sair 21:00 e outro entrar 21:00 pode). O servidor confere de novo.
  const s0 = +toDate(f.startDate, f.startTime), e0 = +toDate(f.endDate, f.endTime);
  const clashes = quote ? busy.filter((b) => +new Date(b.start) < e0 && +new Date(b.end) > s0) : [];

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/reservations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        if (remember) saveProfile(f); else clearProfile(); // lembra o último veículo usado
        onDone(j);
      } else setErr(j.error ?? "Não foi possível reservar. Tente novamente.");
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
            <label>Hora<select className={field} value={f.startTime} onChange={set("startTime")} required>{opts.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label>Saída<input className={field} type="date" min={f.startDate} value={f.endDate} onChange={set("endDate")} required /></label>
            <label>Hora<select className={field} value={f.endTime} onChange={set("endTime")} required>{opts.map((t) => <option key={t}>{t}</option>)}</select></label>
          </div>
          <div className={`grid gap-3 ${presets.length === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}>
            {presets.map(({ k, p, cents }) => (
              <button key={k} type="button" disabled={!p} onClick={() => { if (!p) return; setErr(""); const { late, ...v } = p; setF({ ...f, ...v }); }}
                className="rounded-lg border border-asfalto/20 px-3 py-2 text-left text-sm disabled:opacity-40">
                <div className="font-semibold">{k === "dia" ? "☀️ Dia todo" : k === "pernoite" ? "🌙 Pernoite" : "📅 Fim de semana"}{cents !== null && <span className="font-normal"> · {brl(cents)}</span>}</div>
                <div className="text-asfalto/70">{p ? k === "fimdesemana" ? `sexta ${p.startTime} até segunda ${p.endTime}` : `${p.startTime} até ${p.endTime} do dia seguinte` : "Já passou hoje"}</div>
                {p?.late && <div className="text-xs text-asfalto/60">Hoje: entrada a partir de {p.startTime}</div>}
              </button>
            ))}
          </div>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set("website")} className="absolute -left-[9999px]" />
          {prefilled && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-livre/10 p-3 text-sm">
              <span className="mr-auto">Preenchido com os dados da sua última reserva. Confira e altere se precisar.</span>
              <button type="button" onClick={() => { clearProfile(); setF({ ...f, ...EMPTY }); setPrefilled(false); }} className="underline">Não sou eu</button>
            </div>
          )}
          <label className="block">Nome do responsável<input className={field} value={f.name} onChange={set("name")} required /></label>
          <div className="grid grid-cols-2 gap-3">
            <label>Apartamento<input className={field} value={f.apartment} onChange={set("apartment")} required /></label>
            <label>Placa<input className={field} value={f.plate} onChange={(e) => { setErr(""); setF({ ...f, plate: e.target.value.toUpperCase() }); }} maxLength={8} placeholder="ABC1D23" required /></label>
            <label>Marca<input className={field} value={f.carBrand} onChange={set("carBrand")} required /></label>
            <label>Modelo<input className={field} value={f.carModel} onChange={set("carModel")} required /></label>
            <label>Cor<input className={field} value={f.carColor} onChange={set("carColor")} required /></label>
            <label>WhatsApp <span className="text-asfalto/60">(opcional)</span><input className={field} type="tel" inputMode="tel" autoComplete="tel" maxLength={25} value={f.phone} onChange={set("phone")} placeholder="(43) 99999-8888" /></label>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Lembrar meus dados e o veículo neste aparelho</label>
          {clashes.length > 0 && (
            <div role="alert" className="rounded-xl bg-ocupado/10 p-3 text-sm text-ocupado">
              <b>Esse horário bate com outra reserva:</b>
              <ul className="mt-1 list-disc pl-5">{clashes.map((b, i) => <li key={i}>{span(b.start, b.end)}</li>)}</ul>
              Escolha outro horário. Dá para entrar no exato horário em que a outra reserva termina.
            </div>
          )}
          <div className="rounded-xl bg-concreto p-4">
            {quote ? <>
              <div>Tempo total: {Math.floor(quote.minutes / 60)}h{String(quote.minutes % 60).padStart(2, "0")}</div>
              <div className="text-2xl font-bold">{brl(quote.totalCents)}</div>
              {credit > 0 && <div className="mt-1 text-sm text-livre">💰 Você tem {brl(credit)} de crédito: ele é descontado ao confirmar (primeiro de pendências anteriores, se houver).</div>}
              <PriceBreakdown breakdown={quote.breakdown} className="mt-2" />
            </> : <span className="text-ocupado">A saída precisa ser depois da entrada.</span>}
          </div>
          <p className="text-sm text-asfalto/70">Check-out até <b>{pricing.checkoutTime}</b>. Pernoitou e saiu até esse horário? A manhã não é cobrada.</p>
        </div>
        {err && <p role="alert" className="mx-5 mb-2 max-h-32 shrink-0 overflow-y-auto rounded-lg bg-ocupado/10 p-3 text-ocupado">{err}</p>}
        <div className="flex shrink-0 gap-3 border-t border-asfalto/10 bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-asfalto/20 px-4 py-3">Cancelar</button>
          <button disabled={loading || !quote || clashes.length > 0} className="flex-1 rounded-lg bg-asfalto px-4 py-3 font-semibold text-white disabled:opacity-50">{loading ? "Reservando…" : "Confirmar reserva"}</button>
        </div>
      </form>
    </div>
  );
}
