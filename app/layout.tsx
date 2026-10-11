import "./globals.css";
export const metadata = { title: "Garagem", description: "Consulte a disponibilidade e agende sua utilização." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body className="font-sans antialiased min-h-screen">{children}</body></html>;
}
