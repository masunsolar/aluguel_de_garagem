// Aparece na hora ao entrar em /admin enquanto o servidor confere a sessão (antes a tela ficava congelada).
export default function Carregando() {
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-8" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto h-8 w-56 animate-pulse rounded-lg bg-asfalto/10" />
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="h-11 w-32 animate-pulse rounded-lg bg-asfalto/10" />)}
      </div>
      <p className="text-asfalto/60">Abrindo o painel…</p>
      <div className="h-40 animate-pulse rounded-2xl bg-white" />
      <div className="h-28 animate-pulse rounded-2xl bg-white" />
      <div className="h-24 animate-pulse rounded-2xl bg-white" />
    </main>
  );
}
