import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos } from '@/lib/panelCredentials';

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
    let adminNucleos: string[] = [];
    const sess = readPanelSession(req);
    if (sess) {
      const creds = await loadCreds();
      const acc = creds[sess.u];
      if (acc && !accIsGeral(acc)) {
        adminNucleo = acc.nucleo;
        adminNucleos = accNucleos(acc);
      }
    }

    let { data, error } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, cpf, graduacao, nucleo, foto_url, telefone, email, conta_tipo')
      .order('nome_completo');

    if (error) {
      // Retry without email if column doesn't exist
      const res = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, cpf, graduacao, nucleo, foto_url, telefone, conta_tipo')
        .order('nome_completo');
      data = res.data as typeof data;
    }

    let list = (data || []) as Array<Record<string, unknown>>;

    // Perfis só-responsável não participam da chamada
    list = list.filter(s => s.conta_tipo !== 'responsavel');

    if (adminNucleos.length > 0) {
      // Núcleos do admin: aceita registros gravados com slug ou com nome do núcleo
      const { data: tenants } = await supabaseAdmin
        .from('tenants')
        .select('slug, nome')
        .in('slug', adminNucleos);
      const permitidos = new Set<string>(adminNucleos.map(s => s.toLowerCase()));
      for (const t of tenants || []) {
        const nome = String((t as { nome?: string }).nome || '').trim().toLowerCase();
        if (nome) permitidos.add(nome);
      }
      list = list.filter(s => permitidos.has(String(s.nucleo || '').trim().toLowerCase()));
    }

    return NextResponse.json(list);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erro desconhecido';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
