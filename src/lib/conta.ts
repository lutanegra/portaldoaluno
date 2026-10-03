/**
 * Regra única de classificação de perfis (conta × perfil).
 *
 * Um perfil conta como ALUNO (aparece em chamada, relatórios, lista de alunos
 * e CSV) somente quando realmente treina:
 * - conta sem tipo (NULL/'aluno'): sempre aluno;
 * - 'responsavel_aluno': só se tem núcleo OU matrícula (realmente é aluno);
 * - 'responsavel' (só responsável): nunca.
 */
export function ehPerfilAluno(s: {
  conta_tipo?: string | null;
  ordem_inscricao?: number | null;
  nucleo?: string | null;
}): boolean {
  const tipo = s.conta_tipo || null;
  if (tipo === 'responsavel') return false;
  if (tipo === 'responsavel_aluno') {
    return s.ordem_inscricao != null || !!String(s.nucleo || '').trim();
  }
  return true;
}
