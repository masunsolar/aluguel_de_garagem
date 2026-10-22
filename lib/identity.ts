// Funções puras: rodam no servidor, no navegador e nos testes.
// "Quem é a pessoa" sem login: o vizinho pode trocar de celular ou digitar outro apartamento, então uma
// reserva é da MESMA pessoa se bater QUALQUER UM de: nome completo, placa ou apartamento (cada um normalizado).
import { apartmentKey } from "./apartment";

const plain = (v: string | null | undefined) => (v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "  Karína   SILVA " = "karina silva". Nome com menos de 3 letras não identifica ninguém. */
export function nameKey(v: string | null | undefined): string {
  const k = plain(v).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return k.replace(/ /g, "").length >= 3 ? k : "";
}

/** "abc-1d23" = "ABC1D23". Só vale se parecer placa (antiga ou Mercosul). */
export function plateKey(v: string | null | undefined): string {
  const k = (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(k) ? k : "";
}

export type Who = { name?: string | null; apartment?: string | null; plate?: string | null };

/** Mesma pessoa se nome, placa OU apartamento coincidirem (campo vazio nunca coincide). */
export function samePerson(a: Who, b: Who): boolean {
  const eq = (x: string, y: string) => x !== "" && x === y;
  return eq(nameKey(a.name), nameKey(b.name)) || eq(plateKey(a.plate), plateKey(b.plate)) || eq(apartmentKey(a.apartment), apartmentKey(b.apartment));
}

/**
 * Dono de CRÉDITO (dinheiro a devolver/abater) é mais rígido que a regra de pendência: mesmo nome E mesmo
 * apartamento ou placa. Assim o crédito de uma pessoa não paga a reserva de outra só por morarem no mesmo apto,
 * e ninguém usa o crédito do vizinho digitando só o apartamento dele.
 */
export function sameOwner(a: Who, b: Who): boolean {
  const eq = (x: string, y: string) => x !== "" && x === y;
  return eq(nameKey(a.name), nameKey(b.name)) && (eq(plateKey(a.plate), plateKey(b.plate)) || eq(apartmentKey(a.apartment), apartmentKey(b.apartment)));
}
