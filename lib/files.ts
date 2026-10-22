// Confere o CONTEÚDO do arquivo (assinatura), não o nome nem o Content-Type informado pelo navegador.
export function sniff(b: Buffer): "image/jpeg" | "image/png" | "application/pdf" | null {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b.at(-2) === 0xff && b.at(-1) === 0xd9) return "image/jpeg";
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  return null;
}
/** Cabeçalhos para servir arquivo enviado por usuário: nunca em cache, nunca interpretado como página/script. */
export const privateFileHeaders = (mime: string) => ({
  "Content-Type": mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
  "Content-Disposition": "inline", "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
});

/** Lê o comprovante enviado (campo "file"): imagem JPG/PNG ou PDF de até 2 MB, conferido pelo conteúdo. */
export async function readReceiptUpload(req: Request): Promise<{ bytes: Buffer; mime: string } | Response> {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof File) || file.size > 2_000_000) return Response.json({ error: "Envie uma imagem ou PDF de até 2 MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) return Response.json({ error: "Envie uma imagem (JPG/PNG) ou PDF." }, { status: 400 });
  return { bytes, mime };
}
