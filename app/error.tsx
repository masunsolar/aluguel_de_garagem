"use client";
export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto mt-24 max-w-sm px-4 text-center">
      <h1 className="text-xl font-bold">Algo deu errado</h1>
      <p className="mt-2 text-asfalto/70">Tivemos um problema temporário. Tente novamente em instantes.</p>
      <button onClick={reset} className="mt-4 rounded-lg bg-asfalto px-4 py-2.5 text-white">Tentar de novo</button>
    </main>
  );
}
