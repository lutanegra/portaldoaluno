// Rota temporária de diagnóstico: verifica se as credenciais do Supabase chegaram
// ao processo do app e se o banco responde. Nunca expõe valores — só booleanos,
// status HTTP e nomes de tabelas.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Tabelas e buckets que o app consome (grep em src/).
const TABELAS = [
  'students',
  'checkins',
  'presencas',
  'system_config',
  'tenants',
  'events',
  'event_registrations',
  'financeiro_lancamentos',
  'justificativas',
  'inscricoes_rascunhos',
  'password_recovery',
];

const BUCKETS = ['photos', 'student-photos', 'organograma', 'hierarquia', 'rascunhos'];

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const result: Record<string, unknown> = {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(url),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(anon),
      SUPABASE_SERVICE_ROLE_KEY: Boolean(service),
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
    },
  };

  // Com service_role (ignora RLS), testa cada tabela e bucket que o app usa.
  if (url && service) {
    const admin = createClient(url, service);
    const tabelas: Record<string, string> = {};
    for (const t of TABELAS) {
      const { error } = await admin.from(t).select('*').limit(1);
      tabelas[t] = error ? `erro: ${error.message}` : 'ok';
    }
    result.tabelas = tabelas;

    const buckets: Record<string, string> = {};
    for (const b of BUCKETS) {
      const { error } = await admin.storage.from(b).list('', { limit: 1 });
      buckets[b] = error ? `erro: ${error.message}` : 'ok';
    }
    result.buckets = buckets;
  } else {
    result.acao =
      'Credenciais ausentes no processo do app. Reconecte o Supabase em Settings do projeto e reinicie o preview.';
  }

  return NextResponse.json(result);
}
