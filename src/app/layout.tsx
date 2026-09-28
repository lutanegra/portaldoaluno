import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import LanguageButton from "@/components/LanguageButton";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#e94560",
};

export const metadata: Metadata = {
  title: "Sistema de Gestao de Alunos DEMO",
  description: "Sistema de Gestao de Alunos - Ambiente Demonstrativo",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Gestao DEMO",
  },
  openGraph: {
    title: "Sistema de Gestao de Alunos DEMO",
    description: "Sistema de Gestao de Alunos - Ambiente Demonstrativo",
    siteName: "Sistema de Gestao de Alunos DEMO",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Sistema de Gestao de Alunos DEMO",
    description: "Sistema de Gestao de Alunos - Ambiente Demonstrativo",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.variable} suppressHydrationWarning>
        <LanguageProvider>
          {children}
          <LanguageButton />
        </LanguageProvider>
      </body>
    </html>
  );
}
