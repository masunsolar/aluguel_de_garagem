import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";

// 2ª barreira (além do middleware): a página nem renderiza sem sessão de admin.
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/admin/login");
  return <>{children}</>;
}
