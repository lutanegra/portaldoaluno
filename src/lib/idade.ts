/**
 * CONFIGURAÇÃO CENTRAL DE IDADE — Ginga Gestão
 * Nenhum número mágico espalhado pelo código: todos os limites nascem aqui.
 */

export const MINIMUM_INDEPENDENT_ACCOUNT_AGE = 15;
export const RESPONSIBLE_MINIMUM_AGE = 18;
export const MAIORIDADE = 18;

export type FaixaIdade = 'bloqueado' | 'precisa_autorizacao' | 'independente';

export function idadeEm(dataNascimento: string | null | undefined, hoje: Date = new Date()): number {
  if (!dataNascimento) return -1;
  const dob = new Date(`${String(dataNascimento).slice(0, 10)}T12:00:00`);
  if (isNaN(dob.getTime())) return -1;
  let age = hoje.getFullYear() - dob.getFullYear();
  const m = hoje.getDate() >= 1 ? hoje.getMonth() - dob.getMonth() : 0;
  if (m < 0 || (m === 0 && hoje.getDate() < dob.getDate())) age--;
  return age;
}

/** Classifica a faixa de idade para cadastro de conta individual. */
export function faixaCadastro(idade: number): FaixaIdade {
  if (idade >= 0 && idade < MINIMUM_INDEPENDENT_ACCOUNT_AGE) return 'bloqueado';
  if (idade < MAIORIDADE) return 'precisa_autorizacao';
  return 'independente';
}

export function mensagemFaixa(faixa: FaixaIdade): string {
  if (faixa === 'bloqueado') {
    return 'Cadastro não disponível. Pessoas com até 14 anos precisam ser cadastradas por um pai, mãe ou responsável legal. Peça ao seu responsável para realizar o cadastro e adicionar seu perfil como aluno.';
  }
  if (faixa === 'precisa_autorizacao') {
    return 'Como você tem menos de 18 anos, precisamos da autorização do seu responsável para concluir seu cadastro.';
  }
  return 'Você pode concluir seu cadastro normalmente.';
}
