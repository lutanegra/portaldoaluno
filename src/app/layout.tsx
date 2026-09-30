import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n/LanguageContext";
import LanguageButton from "@/components/LanguageButton";
import SplashGate from "@/components/SplashGate";
import SessionCleanup from "@/components/SessionCleanup";

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
  themeColor: "#0a0a0a",
};

export const metadata: Metadata = {
  title: "Portal Aluno",
  description: "Portal do Aluno — gestao de alunos, carteirinha, presencas e graduacoes",
  icons: { icon: "/logo-portal-aluno.png", apple: "/logo-portal-aluno.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Portal Aluno",
  },
  openGraph: {
    title: "Portal Aluno",
    description: "Portal do Aluno — gestao de alunos, carteirinha, presencas e graduacoes",
    siteName: "Portal Aluno",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Portal Aluno",
    description: "Portal do Aluno — gestao de alunos, carteirinha, presencas e graduacoes",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={inter.variable} suppressHydrationWarning>
        <LanguageProvider>
          <SplashGate />
          {children}
          {/* Seletor de idioma: flutuante apenas na capa (/) e no painel (/admin) */}
          <LanguageButton scope="home-admin" />
          <SessionCleanup />
        </LanguageProvider>
      </body>
    </html>
  );
}
