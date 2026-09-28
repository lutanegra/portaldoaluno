import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termo de Autorizacao - Portal Aluno — Gestao de Treinos",
  description: "Assine o Termo de Autorizacao do Portal Aluno",
  openGraph: {
    title: "Portal Aluno — Gestao de Treinos",
    description: "Termo de Autorizacao - Portal Aluno",
    siteName: "Portal Aluno — Gestao de Treinos",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Portal Aluno — Gestao de Treinos",
    description: "Termo de Autorizacao - Portal Aluno",
  },
};

export default function TermoLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
