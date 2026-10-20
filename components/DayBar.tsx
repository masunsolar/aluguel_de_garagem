import { brtDay, brtToDate } from "@/lib/time";

type Busy = { start: string; end: string };
const DAY = 86_400_000;

/** Barra das 24 h do dia: verde = livre, vermelho = ocupado, cinza = horário que já passou (hoje). */
export default function DayBar({ day, busy }: { day: string; busy: Busy[] }) {
  const a = +brtToDate(day, "00:00"), now = Date.now();
  const pct = (t: number) => `${(Math.min(Math.max(t - a, 0), DAY) / DAY) * 100}%`;
  const past = brtDay(new Date(now)) === day ? now : a > now ? a : a + DAY; // até onde pintar de cinza
  return (
    <div aria-hidden="true" className="mb-3">
      <div className="relative h-5 overflow-hidden rounded-full bg-asfalto/15">
        {past < a + DAY && <div className="absolute inset-y-0 right-0 bg-livre/70" style={{ left: pct(past) }} />}
        {busy.map((b, i) => {
          const s = Math.max(+new Date(b.start), a), e = Math.min(+new Date(b.end), a + DAY);
          return e > s && <div key={i} className="absolute inset-y-0 bg-ocupado" style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} />;
        })}
        {past > a && past < a + DAY && <div className="absolute inset-y-0 w-0.5 bg-asfalto" style={{ left: pct(past) }} title="agora" />}
      </div>
      <div className="relative mt-1 h-4 text-xs text-asfalto/60">
        {[0, 6, 12, 18, 24].map((h) => (
          <span key={h} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, "0")}h</span>
        ))}
      </div>
      <div className="flex gap-3 text-xs text-asfalto/70">
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-livre/70" />livre</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ocupado" />ocupado</span>
        {past > a && <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-asfalto/15" />já passou</span>}
      </div>
    </div>
  );
}
