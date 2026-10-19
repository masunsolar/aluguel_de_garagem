// Funções puras: rodam no servidor, no navegador e nos testes.

/**
 * Chave para comparar apartamentos digitados de jeitos diferentes:
 * "Apto 101", "ap. 101", "101" e " 101 " viram "101"; "101-B" e "101 b" viram "101b".
 */
export function apartmentKey(v: string | null | undefined): string {
  return (v ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // tira acentos
    .toLowerCase().trim()
    .replace(/^(apartamento|apto|apt|ap)\.?\s*(?=[0-9])/, "")
    .replace(/[^a-z0-9]/g, "");
}
