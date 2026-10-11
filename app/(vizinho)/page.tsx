import Booking from "@/components/Booking";
import { getGarageName } from "@/lib/settings";
export const dynamic = "force-dynamic";

export default async function Home() {
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-3xl font-bold tracking-tight">{await getGarageName()}</h1>
      <p className="mt-1 text-asfalto/70">Consulte a disponibilidade e agende sua utilização.</p>
      <Booking />
    </main>
  );
}
