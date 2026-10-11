/** Erro com mensagem segura para mostrar ao usuário. Qualquer outro erro vira "erro temporário" (sem vazar detalhes). */
export class UserError extends Error {}
export class ConflictError extends UserError {
  constructor(message: string, public conflicts: { id: string; label: string }[] = []) { super(message); }
}
export function fail(e: unknown) {
  if (e instanceof ConflictError) return Response.json({ error: e.message, conflicts: e.conflicts }, { status: 409 });
  if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
  console.error("[api]", e);
  return Response.json({ error: "Erro temporário no servidor. Tente novamente em instantes." }, { status: 500 });
}
