import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds } from '@/lib/panelCredentials';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

/**
 * GET /api/presenca/students
 * Lista alunos para a tela de registro de presença.
 * Admin geral/owner: todos os alunos. Admin de núcleo: somente os alunos
 * vinculados ao próprio núcleo (comparando nome e slug do tenant).
 */
export async function GET(req: NextRequest) {
  try {
    let adminNucleo: string | null = null;
    let adminNome: string | null = null;
    const sess = readPanelSession(req);
    if (sess) {
      const creds = await loadCreds();
      const acc = creds[sess.u];
      if (acc) {
        if (acc.nucleo === 'geral') {
          adminNucleo = 'geral';
        } else {
          adminNucleo = acc.nucleo;
          const { data: tenant } = await supabaseAdmin
            .from('tenants')
            .select('nome')
            .eq('slug', acc.nucleo)
            .maybeSingle();
          adminNome = tenant?.nome || acc.nucleo;
        }
      }
    }

    let { data, error } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, cpf, graduacao, nucleo, foto_url, telefone, email')
      .order('nome_completo');

    if (error) {
      // Retry without email if column doesn't exist
      const res = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, cpf, graduacao, nucleo, foto_url, telefone')
        .order('nome_completo');
      data = res.data as typeof data;
    }

    let list = (data || []) as Array<Record<string, unknown>>;

    if (adminNucleo && adminNucleo !== 'geral') {
      list = list.filter(s => {
        const nucleo = String(s.nucleo || '').trim();
        return nucleo === adminNome || nucleo === adminNucleo;
      });
    }

    return NextResponse.json(list);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
