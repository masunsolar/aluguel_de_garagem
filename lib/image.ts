// Reduz a foto no navegador (máx. 1280px, JPEG) antes de enviar: rápido no celular e cabe no plano gratuito.
// Aceita foto da câmera ou da galeria (qualquer formato que o navegador consiga abrir).
export async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file).catch(() => { throw new Error("Não foi possível abrir essa imagem. Tente JPG ou PNG."); });
  const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("Imagem inválida."))), "image/jpeg", 0.8));
}
/** Comprovante: imagem é reduzida para JPEG; PDF vai como está (até 2 MB). */
export async function prepareReceipt(file: File): Promise<{ blob: Blob; name: string }> {
  if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
    if (file.size > 2_000_000) throw new Error("O PDF precisa ter até 2 MB.");
    return { blob: file, name: "comprovante.pdf" };
  }
  return { blob: await shrink(file), name: "comprovante.jpg" };
}
