// Status EXIBIDO. Só leitura: nada é gravado no banco nem muda valor/histórico quando o relógio avança.
// confirmada + já começou => "em andamento"; confirmada + já terminou => "finalizada". Os demais ficam como gravados.
export function effectiveStatus(r: { status: string; start_at: string | Date; end_at: string | Date }, now = Date.now()): string {
  if (r.status !== "confirmada") return r.status;
  if (+new Date(r.end_at) <= now) return "finalizada";
  if (+new Date(r.start_at) <= now) return "em_andamento";
  return r.status;
}
