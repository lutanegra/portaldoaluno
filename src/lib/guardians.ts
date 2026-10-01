import { createClient } from '@supabase/supabase-js';
import { cpfDigits, isValidCPF } from './studentCompliance';
import { idadeEm, RESPONSIBLE_MINIMUM_AGE } from './idade';

/**
 * PERFIS DE RESPONSÁVEL — Ginga Gestão
 *
 * Modelo:
 *  - CONTA: sempre de pessoa adulta; par {student_id, username} em
 *    config/aluno-auth.json. Menores de 15 nunca têm conta própria.
 *  - PERFIL DE ALUNO: linha em `students` (independe de conta).
 *  - PERFIL DE RESPONSÁVEL: linha em `guardians` (1 por aluno adulto).
 *  - VÍNCULO: `guardian_links` N:N (guardian_student_id ↔ student_id),
 *    criado/aprovado/revogado somente no servidor.
 *  - AUTORIZAÇÃO DE ADOLESCENTE: `adolescent_authorizations` para contas
 *    próprias de 15–17 anos (termo versionado, evidências, hash, revogação).
 *
 * Segurança: nenhum caminho de "achar aluno por nome". Vínculo exige código de
 * 6 dígitos gerado a partir do CPF/matrícula do aluno (entregue pelo aluno ou
 * admin) ou ação do painel autenticado. O nome nunca é chave de vínculo.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
export const GUARDIAN_CHECK_KEY = 'config/guardian-checks.json';

export type TutoradoResumo = {
  student_id: string;
  nome_completo: string;
  nucleo: string | null;
  graduacao: string | null;
  foto_url: string | null;
  data_nascimento: string | null;
  idade: number | null;
  menor_de_idade: boolean;
  status_vinculo: string;
  relacao: string;
  criado_em: string | null;
};

export type PerfilResponsavel = {
  student_id: string;
  nome: string;
  cpf_mascarado: string;
  criado_em: string;
  vinculos_ativos: number;
};

type CheckEntry = {
  student_id: string;
  nome_aluno: string;
  guardian_student_id: string;
  codigo: string; // fica só no servidor; nunca vai para a UI
  expires_at: number;
  tentativas: number;
};

/* ── Helpers de storage JSON (mesma estratégia do resto do app) ─────────── */

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(key, 30);
    if (!data?.signedUrl) return fallback;
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

async function saveJson(key: string, value: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  await supabase.storage.from(BUCKET).upload(key, blob, { upsert: true });
}

/* ── Máscaras / rótulos (privacidade: nunca CPF completo na UI) ─────────── */

export function mascararCPF(cpf: string): string {
  const d = cpfDigits(cpf);
  if (d.length !== 11) return '•••.•••.•••-••';
  return `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`;
}

export function mascararEmail(email: string): string {
  const v = String(email || '');
  const at = v.indexOf('@');
  if (at <= 0) return v ? '•••' : '';
  return `${v.slice(0, Math.min(2, at))}•••${v.slice(at)}`;
}

export function mapearRelacao(r: string): string {
  const mapa: Record<string, string> = {
    pai: 'Pai',
    mae: 'Mãe',
    pai_social: 'Pai social',
    mae_social: 'Mãe social',
    responsavel_legal: 'Responsável legal',
    avo: 'Avô/Avó',
    outro: 'Outro',
  };
  return mapa[r] || r || 'Responsável';
}

/* ── Perfil de responsável ────────────────────────────────────────────────── */

export async function obterPerfilResponsavel(studentId: string): Promise<PerfilResponsavel | null> {
  const { data: st } = await supabase
    .from('students')
    .select('nome_completo')
    .eq('id', studentId)
    .maybeSingle();
  if (!st) return null;
  const { data: g } = await supabase
    .from('guardians')
    .select('cpf_digits, criado_em')
    .eq('student_id', studentId)
    .maybeSingle();
  if (!g) return null;
  const { count } = await supabase
    .from('guardian_links')
    .select('id', { count: 'exact', head: true })
    .eq('guardian_student_id', studentId)
    .eq('status', 'active');
  return {
    student_id: studentId,
    nome: st.nome_completo || 'Responsável',
    cpf_mascarado: mascararCPF(g.cpf_digits || ''),
    criado_em: g.criado_em || '',
    vinculos_ativos: count ?? 0,
  };
}

/** Ativa o perfil de responsável para um aluno adulto (18+). Idempotente. */
export async function criarPerfilResponsavel(studentId: string, cpfInformado: string): Promise<{ ok: boolean; error?: string }> {
  const d = cpfDigits(cpfInformado);
  if (!isValidCPF(d)) return { ok: false, error: 'CPF inválido — verifique os dígitos.' };

  const { data: st } = await supabase
    .from('students')
    .select('nome_completo, data_nascimento')
    .eq('id', studentId)
    .maybeSingle();
  if (!st) return { ok: false, error: 'Aluno não encontrado.' };

  const idade = idadeEm(st.data_nascimento || '');
  if (idade < RESPONSIBLE_MINIMUM_AGE) {
    return { ok: false, error: 'Função de responsável indisponível: é necessário ter 18 anos ou mais.' };
  }

  // Um CPF de responsável só pode estar ativo em um perfil (proteção contra
  // falso responsável reutilizando o documento de outra pessoa).
  const { data: outro } = await supabase
    .from('guardians')
    .select('student_id')
    .eq('cpf_digits', d)
    .maybeSingle();
  if (outro && outro.student_id !== studentId) {
    return { ok: false, error: 'Este CPF já está ativo como responsável em outro perfil. Procure o admin do seu núcleo.' };
  }

  const { error } = await supabase
    .from('guardians')
    .upsert({ student_id: studentId, cpf_digits: d }, { onConflict: 'student_id' });
  if (error) return { ok: false, error: 'Não foi possível ativar o perfil de responsável.' };
  return { ok: true };
}

/** Desativa o perfil (os vínculos caem por cascade). Histórico fica na auditoria. */
export async function desativarPerfilResponsavel(studentId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from('guardians').delete().eq('student_id', studentId);
  if (error) return { ok: false, error: 'Não foi possível desativar o perfil.' };
  return { ok: true };
}

/* ── Tutelados do responsável ─────────────────────────────────────────────── */

export async function tutoradosDoResponsavel(studentId: string): Promise<TutoradoResumo[]> {
  const { data: links } = await supabase
    .from('guardian_links')
    .select('student_id, relacao, status, created_at')
    .eq('guardian_student_id', studentId)
    .in('status', ['active', 'pending']);
  const ids = (links || []).map(l => l.student_id);
  if (ids.length === 0) return [];
  const { data: alunos } = await supabase
    .from('students')
    .select('id, nome_completo, nucleo, graduacao, foto_url, data_nascimento')
    .in('id', ids);
  const byId = new Map((alunos || []).map(a => [a.id, a]));
  return (links || []).map(l => {
    const a = byId.get(l.student_id) as Record<string, unknown> | undefined;
    const dn = String(a?.data_nascimento || '') || null;
    const idade = dn ? idadeEm(dn) : -1;
    return {
      student_id: l.student_id,
      nome_completo: String(a?.nome_completo || '—'),
      nucleo: ((a?.nucleo as string) || null),
      graduacao: ((a?.graduacao as string) || null),
      foto_url: ((a?.foto_url as string) || null),
      data_nascimento: dn,
      idade: idade >= 0 ? idade : null,
      menor_de_idade: idade >= 0 && idade < 18,
      status_vinculo: l.status,
      relacao: l.relacao,
      criado_em: l.created_at || null,
    };
  });
}

/**
 * true quando a conta autenticada (sessão) pode agir sobre o aluno informado —
 * a si mesmo ou como responsável com vínculo ACTIVE. pending/rejected/revoked
 * nunca concedem acesso.
 */
export async function podeAgirComo(sessaoStudentId: string, targetStudentId: string): Promise<boolean> {
  if (sessaoStudentId === targetStudentId) return true;
  const { data } = await supabase
    .from('guardian_links')
    .select('id')
    .eq('guardian_student_id', sessaoStudentId)
    .eq('student_id', targetStudentId)
    .eq('status', 'active')
    .limit(1);
  return !!(data && data.length > 0);
}

/** Vínculos pendentes direcionados a um aluno (para o aluno autorizar). */
export async function vinculosPendentesDoAluno(studentId: string): Promise<{ guardian_student_id: string; nome: string; relacao: string }[]> {
  const { data: links } = await supabase
    .from('guardian_links')
    .select('guardian_student_id, relacao')
    .eq('student_id', studentId)
    .eq('status', 'pending');
  const ids = (links || []).map(l => l.guardian_student_id);
  if (ids.length === 0) return [];
  const { data: guardianes } = await supabase
    .from('students')
    .select('id, nome_completo')
    .in('id', ids);
  const nomes = new Map((guardianes || []).map(g => [g.id, g.nome_completo]));
  return (links || []).map(l => ({
    guardian_student_id: l.guardian_student_id,
    nome: nomes.get(l.guardian_student_id) || 'Responsável',
    relacao: l.relacao,
  }));
}

/* ── Criação/decisão de vínculos ─────────────────────────────────────────── */

export type CriarVinculoResult = { ok: boolean; error?: string; status?: string };

/**
 * Cria (ou reativa) o vínculo. Sem painel, o vínculo nasce 'pending' e o aluno
 * precisa autorizar. Com painel, nasce 'active'.
 */
export async function criarVinculo(
  guardianId: string,
  studentId: string,
  relacao: string,
  opts: { viaPainel: boolean; loginPainel?: string },
): Promise<CriarVinculoResult> {
  if (guardianId === studentId) return { ok: false, error: 'Você não pode se adicionar como tutelado.' };
  const { data: perfil } = await supabase.from('guardians').select('student_id').eq('student_id', guardianId).maybeSingle();
  if (!perfil) return { ok: false, error: 'Ative o perfil de responsável antes de adicionar tutelados.' };
  const { data: aluno } = await supabase.from('students').select('id').eq('id', studentId).maybeSingle();
  if (!aluno) return { ok: false, error: 'Código inválido — aluno não encontrado.' };

  const status = opts.viaPainel ? 'active' : 'pending';
  const { data: existente } = await supabase
    .from('guardian_links')
    .select('id, status')
    .eq('guardian_student_id', guardianId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (existente) {
    if (existente.status === 'active') return { ok: true, status: 'active' };
    if (existente.status === 'pending') return { ok: true, status: 'pending' };
    // rejected/revoked: só reativa com aprovação do painel ou novo aceite do aluno
    return { ok: false, error: 'Este vínculo já existiu e foi recusado/revogado. Procure o admin do seu núcleo para reativar.' };
  }

  const { error } = await supabase.from('guardian_links').insert({
    guardian_student_id: guardianId,
    student_id: studentId,
    relacao: relacao || 'responsavel_legal',
    status,
    criado_por: opts.viaPainel ? `painel:${opts.loginPainel || ''}` : 'responsavel',
    aprovado_em: opts.viaPainel ? new Date().toISOString() : null,
  });
  if (error) return { ok: false, error: 'Não foi possível criar o vínculo.' };
  return { ok: true, status };
}

/** O aluno autoriza (aprova) um vínculo pendente dirigido a ele. */
export async function alunoDecideVinculoPendente(
  studentId: string,
  guardianId: string,
  aprovar: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const { data: link } = await supabase
    .from('guardian_links')
    .select('id, status')
    .eq('guardian_student_id', guardianId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (!link) return { ok: false, error: 'Solicitação não encontrada.' };
  if (link.status !== 'pending') return { ok: false, error: 'Esta solicitação já foi resolvida.' };
  const novoStatus = aprovar ? 'active' : 'rejected';
  const { error } = await supabase
    .from('guardian_links')
    .update({ status: novoStatus, aprovado_em: aprovar ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq('id', link.id);
  if (error) return { ok: false, error: 'Não foi possível concluir a operação.' };
  return { ok: true };
}

/** Revoga um vínculo ativo. Quem revoga: o próprio responsável, o aluno ou o painel. */
export async function revogarVinculo(
  guardianId: string,
  studentId: string,
  revogadoPor: string,
  motivo?: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: link } = await supabase
    .from('guardian_links')
    .select('id, status')
    .eq('guardian_student_id', guardianId)
    .eq('student_id', studentId)
    .maybeSingle();
  if (!link) return { ok: false, error: 'Vínculo não encontrado.' };
  if (link.status === 'revoked') return { ok: true };
  const { error } = await supabase
    .from('guardian_links')
    .update({
      status: 'revoked',
      revogado_em: new Date().toISOString(),
      revogado_por: revogadoPor,
      revogado_motivo: motivo || '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', link.id);
  if (error) return { ok: false, error: 'Não foi possível revogar o vínculo.' };
  return { ok: true };
}

/* ── Código de vínculo (prova de contato com o aluno) ────────────────────── */

const CODIGO_TTL_MS = 10 * 60 * 1000;
const MAX_TENTATIVAS = 5;

/**
 * Gera o código de autorização do ALUNO. O aluno vê o código no app (aba
 * Minha Conta/Responsáveis) ou o admin lê no painel — quem tem o código prova
 * contato com o aluno. O responsável informa o código + a matrícula (CCLN-000).
 */
export async function publicarCodigoDoAluno(studentId: string): Promise<{ ok: boolean; error?: string; codigo?: string; expira_em?: number }> {
  const { data: aluno } = await supabase
    .from('students')
    .select('id, nome_completo, ordem_inscricao')
    .eq('id', studentId)
    .maybeSingle();
  if (!aluno) return { ok: false, error: 'Aluno não encontrado.' };

  const map = await loadJson<Record<string, CheckEntry>>(GUARDIAN_CHECK_KEY, {});
  // Invalida códigos anteriores do mesmo aluno
  for (const k of Object.keys(map)) {
    if (map[k].student_id === studentId) delete map[k];
  }
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  const rand = Math.random().toString(36).slice(2, 10);
  map[rand] = {
    student_id: aluno.id,
    nome_aluno: aluno.nome_completo || '',
    guardian_student_id: '',
    codigo,
    expires_at: Date.now() + CODIGO_TTL_MS,
    tentativas: 0,
  };
  await saveJson(GUARDIAN_CHECK_KEY, map);
  return { ok: true, codigo, expira_em: map[rand].expires_at };
}

/**
 * Valida: código de 6 dígitos + matrícula do aluno. O par precisa bater com a
 * MESMA entrada — código vazado sozinho não vincula ninguém.
 */
export async function consumirCodigoVinculo(
  codigo: string,
  matricula: string,
): Promise<{ ok: boolean; error?: string; student_id?: string; nome_aluno?: string }> {
  const map = await loadJson<Record<string, CheckEntry>>(GUARDIAN_CHECK_KEY, {});
  const code = String(codigo || '').replace(/\D/g, '');
  const mat = String(matricula || '').replace(/\D/g, '');

  // Matrícula → aluno (fonte de verdade: ordem_inscricao)
  let studentIdPorMatricula: string | null = null;
  if (mat) {
    const { data: byMat } = await supabase
      .from('students')
      .select('id')
      .eq('ordem_inscricao', parseInt(mat, 10))
      .maybeSingle();
    studentIdPorMatricula = byMat?.id || null;
  }
  if (!studentIdPorMatricula) return { ok: false, error: 'Matrícula não encontrada. Use o número CCLN do aluno.' };

  // Procura uma entrada vigente desse aluno
  const agora = Date.now();
  const chave = Object.keys(map).find(k => {
    const e = map[k];
    return e.student_id === studentIdPorMatricula && e.expires_at > agora;
  });
  if (!chave) return { ok: false, error: 'Nenhum código vigente para esta matrícula. Peça um novo código ao aluno.' };

  const entry = map[chave];
  if (entry.tentativas >= MAX_TENTATIVAS) {
    delete map[chave];
    await saveJson(GUARDIAN_CHECK_KEY, map);
    return { ok: false, error: 'Muitas tentativas. Peça um novo código ao aluno.' };
  }
  if (entry.tentativas >= MAX_TENTATIVAS || code.length !== 6) {
    entry.tentativas += 1;
    await saveJson(GUARDIAN_CHECK_KEY, map);
    return { ok: false, error: 'Código incorreto.' };
  }
  if (entry.guardian_student_id) {
    // código já consumido por outro fluxo
    delete map[chave];
    await saveJson(GUARDIAN_CHECK_KEY, map);
    return { ok: false, error: 'Código já utilizado. Peça um novo ao aluno.' };
  }
  if (code !== entry.codigo) {
    entry.tentativas += 1;
    await saveJson(GUARDIAN_CHECK_KEY, map);
    return { ok: false, error: 'Código incorreto.' };
  }

  // Marca como consumido (guardian preencherá o vínculo em seguida)
  entry.guardian_student_id = 'consumido';
  entry.expires_at = Date.now() + 5 * 60 * 1000;
  await saveJson(GUARDIAN_CHECK_KEY, map);
  return { ok: true, student_id: entry.student_id, nome_aluno: entry.nome_aluno };
}
