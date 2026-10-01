/**
 * Conformidade cadastral do aluno (validação no servidor, arquivo sem "use client").
 *
 * Regras:
 *  — RG (identidade) e CPF são OBRIGATÓRIOS: sem eles o cadastro não é salvo.
 *  — Aluno menor de idade precisa de: termo assinado + nome do responsável + CPF do responsável.
 *  — Aluno em descumprimento não executa ações no app (presença, justificativa, financeiro).
 */
import { idadeEm as idadeEmCentral } from '@/lib/idade';

/** Dígitos verificadores do CPF (padrão da Receita). */
export function isValidCPF(input: string): boolean {
  const cpf = String(input || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf[i], 10) * (10 - i);
  let r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  if (r !== parseInt(cpf[9], 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf[i], 10) * (11 - i);
  r = (sum * 10) % 11;
  if (r === 10 || r === 11) r = 0;
  return r === parseInt(cpf[10], 10);
}

/** RG: 5 a 20 caracteres alfanuméricos (pontos, traço e espaços permitidos). */
export function isValidRG(input: string): boolean {
  const v = String(input || '').trim();
  return /^[0-9A-Za-z][0-9A-Za-z.\-\s]{3,18}[0-9A-Za-zXx]$/.test(v);
}

export function cpfDigits(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

/** Idade a partir da data de nascimento AAAA-MM-DD (delega à fonte única: lib/idade). */
export function idadeEm(dataNascimento: string, hoje: Date = new Date()): number {
  return idadeEmCentral(dataNascimento, hoje);
}

export interface StudentDocsLike {
  cpf?: string | null;
  identidade?: string | null;
  data_nascimento?: string | null;
  menor_de_idade?: boolean | null;
  assinatura_responsavel?: boolean | null;
  nome_responsavel?: string | null;
  cpf_responsavel?: string | null;
}

export interface Pendencia {
  campo: string;
  label: string;
}

/**
 * Lista as pendências cadastrais do aluno.
 * O parâmetro `menor` permite informar o flag já calculado pelo chamador;
 * quando omitido, é deduzido da data de nascimento.
 */
export function pendenciasAluno(
  s: StudentDocsLike,
  menor?: boolean,
): Pendencia[] {
  const out: Pendencia[] = [];
  const cpf = cpfDigits(s.cpf || '');
  if (!cpf || !isValidCPF(cpf)) out.push({ campo: 'cpf', label: 'CPF' });
  if (!s.identidade || !String(s.identidade).trim() || !isValidRG(String(s.identidade))) out.push({ campo: 'identidade', label: 'RG' });

  let menorDeIdade: boolean;
  if (typeof menor === 'boolean') {
    menorDeIdade = menor;
  } else if (typeof s.menor_de_idade === 'boolean') {
    menorDeIdade = s.menor_de_idade;
  } else {
    const idade = idadeEm(s.data_nascimento || '');
    menorDeIdade = idade >= 0 && idade < 18;
  }
  if (menorDeIdade) {
    if (!s.assinatura_responsavel) out.push({ campo: 'termo', label: 'Termo do responsável' });
    if (!s.nome_responsavel || !String(s.nome_responsavel).trim()) out.push({ campo: 'nome_responsavel', label: 'Nome do responsável' });
    if (!cpfDigits(s.cpf_responsavel || '')) out.push({ campo: 'cpf_responsavel', label: 'CPF do responsável' });
  }
  return out;
}

/** true quando o aluno está liberado para executar ações no app. */
export function alunoEmConformidade(s: StudentDocsLike, menor?: boolean): boolean {
  return pendenciasAluno(s, menor).length === 0;
}

export function resumoPendencias(s: StudentDocsLike, menor?: boolean): string {
  const p = pendenciasAluno(s, menor).map(x => x.label);
  if (p.length === 0) return '';
  return p.join(', ');
}
