import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "A medias · Gastos compartidos",
  description: "Revisa tus tickets y reparte los productos que compartís, sin perder un céntimo.",
  applicationName: "A medias",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, statusBarStyle: "default", title: "A medias" }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f6fb" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
