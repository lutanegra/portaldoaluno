import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos } from '@/lib/panelCredentials';
import { appendAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

/**
 * RELATÓRIO DE UNIFORMES — somente painel (v1.6.4).
 *
 * GET ?nucleo=<nome|slug do núcleo>
 * Devolve a lista de alunos (perfis de aluno ativos) com as medidas de
 * uniforme lançadas pela administração, para geração da folha de conferência
 * da confecção. Mesma autorização e filtro de núcleo do relatório
 * quantitativo; lista em ordem alfabética.
 */

function nucleosDoAdmin(req: NextRequest): Promise<string[] | 'geral' | null> {
  return (async () => {
    const sess = readPanelSession(req);
    if (!sess) return null;
    const creds = await loadCreds();
    const acc = creds[sess.u];
    if (!acc) return null;
    if (accIsGeral(acc)) return 'geral';
    const slugs = accNucleos(acc);
    if (slugs.length === 0) return [];
    const { data: tenants } = await supabase.from('tenants').select('nome').in('slug', slugs);
    return [...slugs, ...(tenants || []).map((t: { nome?: string }) => t.nome || '').filter(Boolean)];
  })();
}

function dentroDosNucleos(nucleoAluno: string | null | undefined, nucleos: string[] | 'geral'): boolean {
  if (nucleos === 'geral') return true;
  const alvo = String(nucleoAluno || '').trim().toLowerCase();
  if (!alvo) return false;
  return nucleos.some(n => n.trim().toLowerCase() === alvo);
}

export async function GET(req: NextRequest) {
  const nucleos = await nucleosDoAdmin(req);
  if (nucleos === null) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });

  const nucleoParam = String(req.nextUrl.searchParams.get('nucleo') || '').trim();
  const nucleoLower = nucleoParam.toLowerCase();

  const { data: alunos, error } = await supabase
    .from('students')
    .select('id, nome_completo, apelido, nucleo, graduacao, ordem_inscricao, conta_tipo, uniforme_camisa_tamanho, uniforme_calca_altura, uniforme_calca_cintura, uniforme_calca_gaviao, uniforme_camisa_grupo, uniforme_camisa_projeto')
    .is('deleted_at', null)
    .order('nome_completo', { ascending: true });

  if (error) return NextResponse.json({ error: 'Falha ao carregar alunos.' }, { status: 500 });

  // Somente perfis de aluno (contas só-responsável não recebem uniforme).
  const perfisAluno = (alunos || []).filter(a => a.conta_tipo !== 'responsavel');

  const visiveis = nucleoLower
    ? perfisAluno.filter(a => String(a.nucleo || '').trim().toLowerCase() === nucleoLower)
    : perfisAluno;

  const listaBase = nucleoLower
    ? visiveis.filter(a => dentroDosNucleos(a.nucleo, nucleos))
    : perfisAluno.filter(a => dentroDosNucleos(a.nucleo, nucleos));

  const fmtMat = (ordem: number | null | undefined): string => {
    const n = typeof ordem === 'number' && Number.isFinite(ordem) ? ordem : null;
    return n !== null ? `CCLN-${String(n).padStart(3, '0')}` : '';
  };

  const rows = listaBase.map(a => ({
    id: a.id,
    nome: a.nome_completo || '—',
    apelido: a.apelido || '',
    nucleo: a.nucleo || '',
    graduacao: a.graduacao || '',
    matricula: fmtMat(a.ordem_inscricao),
    camisa_tamanho: a.uniforme_camisa_tamanho || '',
    calca_altura: a.uniforme_calca_altura || '',
    calca_cintura: a.uniforme_calca_cintura || '',
    calca_gaviao: a.uniforme_calca_gaviao || '',
    camisa_grupo: a.uniforme_camisa_grupo || '',
    camisa_projeto: a.uniforme_camisa_projeto || '',
  }));

  rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }));

  const comMedidas = rows.filter(a => a.camisa_tamanho || a.calca_altura || a.calca_cintura || a.calca_gaviao || a.camisa_grupo || a.camisa_projeto).length;

  try {
    await appendAudit({
      actor: 'painel',
      actor_type: 'admin',
      action: 'relatorio_uniformes',
      details: { nucleo: nucleoLower || 'todos', total: rows.length, com_medidas: comMedidas },
    });
  } catch { /* auditoria não deve derrubar o relatório */ }

  return NextResponse.json({
    total: rows.length,
    com_medidas: comMedidas,
    sem_medidas: rows.length - comMedidas,
    alunos: rows,
  });
}
