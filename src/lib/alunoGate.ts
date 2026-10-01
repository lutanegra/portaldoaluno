import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { alunoEmConformidade, resumoPendencias } from '@/lib/studentCompliance';

/**
 * Gate de conformidade cadastral do aluno.
 *
 * Rotas de AÇÃO do aluno (presença, justificativa, financeiro, salvamento de
 * dados) chamam o gate antes de gravar: sem CPF/RG válidos — e, para menores,
 * sem termo + responsável — a ação é recusada com 403 e o aluno é guiado a
 * completar o cadastro. Admins autenticados pelo painel (cookie de sessão)
 * passam, pois agem em nome do aluno.
 */

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

export interface GateMenorInfo {
  menor_de_idade?: boolean | null;
  data_nascimento?: string | null;
}

async function bloqueioPara(studentId: string, menorInfo?: GateMenorInfo): Promise<NextResponse | null> {
  const { data: student } = await supabase
    .from('students')
    .select('cpf, identidade, data_nascimento, menor_de_idade, assinatura_responsavel, nome_responsavel, cpf_responsavel')
    .eq('id', studentId)
    .maybeSingle();

  if (!student) {
    return NextResponse.json(
      { error: 'Aluno não encontrado.', pendencias: ['cadastro'], acao: 'contato_admin' },
      { status: 403 },
    );
  }

  if (alunoEmConformidade(student, menorInfo?.menor_de_idade ?? undefined)) return null;

  const resumo = resumoPendencias(student, menorInfo?.menor_de_idade ?? undefined);
  return NextResponse.json(
    {
      error: `Cadastro incompleto — pendência(s): ${resumo}. Complete seus dados na aba Meus Dados (e o Termo, se menor de idade) para continuar.`,
      pendencias: resumo.split(', '),
      acao: 'completar_cadastro',
    },
    { status: 403 },
  );
}

/**
 * Gate para rotas com Request em mãos (caso padrão):
 * admins do painel executam ações em nome do aluno sem gate; alunos precisam
 * estar em conformidade cadastral.
 */
export async function exigirConformidadeAluno(
  req: Request,
  studentId: string,
  menorInfo?: GateMenorInfo,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (readPanelSession(req)) return { ok: true };
  const bloqueio = await bloqueioPara(studentId, menorInfo);
  if (bloqueio) return { ok: false, response: bloqueio };
  return { ok: true };
}

/**
 * Gate sem Request (rotas onde a sessão de painel já foi validada por outro
 * meio e o chamador informa explicitamente que é contexto administrativo).
 */
export async function exigirConformidadeAlunoServidor(
  studentId: string,
  menorInfo?: GateMenorInfo,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const bloqueio = await bloqueioPara(studentId, menorInfo);
  if (bloqueio) return { ok: false, response: bloqueio };
  return { ok: true };
}
