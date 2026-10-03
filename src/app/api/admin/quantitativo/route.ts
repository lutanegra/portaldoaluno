import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos } from '@/lib/panelCredentials';
import { appendAudit } from '@/lib/audit';
import { ehPerfilAluno } from '@/lib/conta';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

/**
 * RELATÓRIO QUANTITATIVO DE ALUNOS — somente painel.
 *
 * GET ?nucleo=<nome|slug do núcleo>
 * Devolve a base do relatório de prestação de contas:
 *  - lista de alunos ativos (fora da lixeira) com nome, idade, data de
 *    nascimento, CPF, núcleo e — para menores de 18 — nome e CPF do
 *    responsável (registro do termo; fallback: vínculo ativo de responsável);
 *  - totais geral/maior/menor SEMPRE coerentes com o filtro de núcleo;
 *  - dados por núcleo e faixas de idade para os gráficos.
 * Idade calculada no servidor pela data de nascimento (mesma regra do app).
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
    .select('id, nome_completo, cpf, data_nascimento, nucleo, conta_tipo, nome_responsavel, cpf_responsavel, menor_de_idade, ordem_inscricao, created_at')
    .is('deleted_at', null)
    .order('nome_completo', { ascending: true });

  if (error) return NextResponse.json({ error: 'Falha ao carregar alunos.' }, { status: 500 });

  // Somente perfis de aluno (contas de responsável sem matrícula e sem núcleo
  // não fazem parte do quantitativo).
  const perfisAluno = (alunos || []).filter(a => ehPerfilAluno(a));

  const filtrados = nucleoLower
    ? perfisAluno.filter(a => String(a.nucleo || '').trim().toLowerCase() === nucleoLower)
    : perfisAluno;

  // Só-responsável (sem núcleo) não passa no filtro por nome de núcleo: para o
  // admin de núcleo enxergar seus tutelados, resolvemos os guardiões do núcleo.
  let idsGuardioesDoNucleo: string[] = [];
  if (nucleoLower) {
    const { data: links } = await supabase
      .from('guardian_links')
      .select('guardian_student_id, student_id, status')
      .eq('status', 'active');
    const alunosNoNucleo = new Set(
      perfisAluno.filter(a => String(a.nucleo || '').trim().toLowerCase() === nucleoLower).map(a => a.id),
    );
    idsGuardioesDoNucleo = (links || [])
      .filter(l => alunosNoNucleo.has(l.student_id))
      .map(l => l.guardian_student_id);
  }

  const visiveis = nucleoLower
    ? filtrados.filter(a => !!String(a.nucleo || '').trim() || idsGuardioesDoNucleo.includes(a.id))
    : filtrados;
  const listaBase = nucleoLower
    ? visiveis.filter(a => dentroDosNucleos(a.nucleo, nucleos))
    : perfisAluno.filter(a => dentroDosNucleos(a.nucleo, nucleos));

  // Responsável de cada menor: registro do termo (nome_responsavel/cpf_responsavel
  // no cadastro) com fallback para o vínculo ativo (guardian_links + guardians).
  const menoresIds = listaBase
    .filter(a => {
      if (a.nome_responsavel || a.cpf_responsavel) return false;
      const dn = String(a.data_nascimento || '').slice(0, 10);
      if (!dn) return false;
      const dob = new Date(`${dn}T12:00:00`);
      if (isNaN(dob.getTime())) return false;
      const hoje = new Date();
      let idade = hoje.getFullYear() - dob.getFullYear();
      const m = hoje.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && hoje.getDate() < dob.getDate())) idade--;
      return idade >= 0 && idade < 18;
    })
    .map(a => a.id);

  const respFallback = new Map<string, { nome: string; cpf: string }>();
  if (menoresIds.length > 0) {
    const { data: links } = await supabase
      .from('guardian_links')
      .select('guardian_student_id, student_id, status, relacao')
      .in('student_id', menoresIds)
      .eq('status', 'active');
    const gids = [...new Set((links || []).map(l => l.guardian_student_id))];
    const { data: guardians } = gids.length
      ? await supabase.from('guardians').select('student_id, nome_completo, cpf_digits').in('student_id', gids)
      : { data: [] };
    const gMap = new Map((guardians || []).map(g => [g.student_id, g]));
    for (const l of links || []) {
      const g = gMap.get(l.guardian_student_id);
      if (!g) continue;
      const atual = respFallback.get(l.student_id);
      if (!atual) {
        respFallback.set(l.student_id, {
          nome: g.nome_completo || '',
          cpf: g.cpf_digits ? g.cpf_digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '',
        });
      }
    }
  }

  // Faixa etária de referência (capoeira — graduação por idade)
  const FAIXAS: Array<{ label: string; min: number; max: number }> = [
    { label: '0–4 anos', min: 0, max: 4 },
    { label: '5–7 anos', min: 5, max: 7 },
    { label: '8–11 anos', min: 8, max: 11 },
    { label: '12–14 anos', min: 12, max: 14 },
    { label: '15–17 anos', min: 15, max: 17 },
    { label: '18–24 anos', min: 18, max: 24 },
    { label: '25–34 anos', min: 25, max: 34 },
    { label: '35–44 anos', min: 35, max: 44 },
    { label: '45+ anos', min: 45, max: 200 },
  ];

  const idadeDe = (dn: string | null): number => {
    const s = String(dn || '').slice(0, 10);
    if (!s) return -1;
    const dob = new Date(`${s}T12:00:00`);
    if (isNaN(dob.getTime())) return -1;
    const hoje = new Date();
    let idade = hoje.getFullYear() - dob.getFullYear();
    const m = hoje.getMonth() - dob.getMonth();
    if (m === 0 ? hoje.getDate() < dob.getDate() : m < 0) idade--;
    return idade;
  };

  let maiores = 0;
  let menores = 0;
  let semDataNascimento = 0;
  let somaIdades = 0;
  const contagemFaixas = new Map<string, number>();
  const porNucleo = new Map<string, { total: number; maiores: number; menores: number }>();

  const rows = listaBase.map(a => {
    const dn = String(a.data_nascimento || '').slice(0, 10) || null;
    const idade = idadeDe(dn);
    const menor = idade >= 0 ? idade < 18 : a.menor_de_idade === true;
    if (idade >= 0) {
      if (menor) menores += 1; else maiores += 1;
      somaIdades += idade;
      const faixa = FAIXAS.find(f => idade >= f.min && idade <= f.max);
      if (faixa) contagemFaixas.set(faixa.label, (contagemFaixas.get(faixa.label) || 0) + 1);
    } else {
      semDataNascimento += 1;
    }
    const nucleoNome = a.nucleo || 'Sem núcleo';
    const agg = porNucleo.get(nucleoNome) || { total: 0, maiores: 0, menores: 0 };
    agg.total += 1;
    if (idade >= 0) { if (menor) agg.menores += 1; else agg.maiores += 1; }
    porNucleo.set(nucleoNome, agg);
    const fb = respFallback.get(a.id);
    return {
      id: a.id,
      nome: a.nome_completo || '—',
      cpf: a.cpf || '',
      data_nascimento: dn,
      idade: idade >= 0 ? idade : null,
      nucleo: a.nucleo || null,
      menor,
      resp_nome: a.nome_responsavel || fb?.nome || '',
      resp_cpf: a.cpf_responsavel || fb?.cpf || '',
      criado_em: a.created_at,
    };
  });

  rows.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const total = rows.length;
  const nucleosAgg = [...porNucleo.entries()].map(([nome, v]) => ({ nucleo: nome, ...v }));
  nucleosAgg.sort((a, b) => b.total - a.total);

  try {
    await appendAudit({
      actor: 'painel',
      actor_type: 'admin',
      action: 'relatorio_quantitativo',
      details: { nucleo: nucleoLower || 'todos', total },
    });
  } catch { /* auditoria não deve derrubar o relatório */ }

  return NextResponse.json({
    total,
    maiores,
    menores,
    sem_data_nascimento: semDataNascimento,
    media_idade: total > 0 ? Math.round((somaIdades / (total - semDataNascimento || 1)) * 10) / 10 : 0,
    faixas: FAIXAS.map(f => ({ label: f.label, quantidade: contagemFaixas.get(f.label) || 0 })),
    por_nucleo: nucleosAgg,
    alunos: rows,
  });
}
