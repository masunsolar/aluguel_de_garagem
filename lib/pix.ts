// PIX "copia e cola" (BR Code estático). Funções puras: rodam no navegador e nos testes.
export type PixConfig = { key: string; name: string; city: string };
export const EMPTY_PIX: PixConfig = { key: "", name: "", city: "" };

const ascii = (s: string, max: number) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").trim().toUpperCase().slice(0, max);
const f = (id: string, v: string) => id + String(v.length).padStart(2, "0") + v;

export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Retorna null se faltar chave, nome ou cidade (aí só mostramos a chave para copiar).
export function pixPayload(p: PixConfig, amountCents: number): string | null {
  const name = ascii(p.name, 25), city = ascii(p.city, 15), key = p.key.trim();
  if (!key || !name || !city || !Number.isInteger(amountCents) || amountCents <= 0) return null;
  const body =
    f("00", "01") + f("26", f("00", "br.gov.bcb.pix") + f("01", key)) + f("52", "0000") + f("53", "986") +
    f("54", (amountCents / 100).toFixed(2)) + f("58", "BR") + f("59", name) + f("60", city) + f("62", f("05", "***")) + "6304";
  return body + crc16(body);
}
