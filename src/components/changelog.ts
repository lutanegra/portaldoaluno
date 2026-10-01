/**
 * CHANGELOG OFICIAL do sistema.
 * A entrada mais recente vem PRIMEIRO. Cada versão tem uma única entrada aqui,
 * agrupando todas as alterações daquela tarefa (uma versão por implementação).
 *
 * Categorias: 'novo' | 'melhorias' | 'correcoes' | 'interface' | 'seguranca' | 'desempenho'
 *
 * Em futuras implementações relevantes:
 *  1. determine MAJOR/MINOR/PATCH;
 *  2. atualize APP_VERSION em src/lib/version.ts (uma única vez por tarefa);
 *  3. adicione a entrada desta versão NO TOPO deste array.
 */

export type ChangelogCategoria =
  | 'novo'
  | 'melhorias'
  | 'correcoes'
  | 'interface'
  | 'seguranca'
  | 'desempenho';

export interface ChangelogItem {
  categoria: ChangelogCategoria;
  texto: string;
}

export interface ChangelogEntry {
  versao: string;
  data: string; // AAAA-MM-DD
  titulo: string;
  descricao: string;
  itens: ChangelogItem[];
}

export const CATEGORIA_META: Record<ChangelogCategoria, { label: string; cor: string; bg: string; border: string }> = {
  novo:       { label: 'Novo',        cor: '#4ade80', bg: 'rgba(74,222,128,0.10)',  border: 'rgba(74,222,128,0.35)' },
  melhorias:  { label: 'Melhorias',   cor: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  border: 'rgba(96,165,250,0.35)' },
  correcoes:  { label: 'Correções',   cor: '#f87171', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.35)' },
  interface:  { label: 'Interface',   cor: '#FF9200', bg: 'rgba(255,146,0,0.10)',   border: 'rgba(255,146,0,0.35)' },
  seguranca:  { label: 'Segurança',   cor: '#c084fc', bg: 'rgba(192,132,252,0.10)', border: 'rgba(192,132,252,0.35)' },
  desempenho: { label: 'Desempenho',  cor: '#fde047', bg: 'rgba(253,224,71,0.10)',  border: 'rgba(253,224,71,0.35)' },
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    versao: '1.0.0',
    data: '2026-10-01',
    titulo: 'Primeira versão oficial',
    descricao:
      'Lançamento da versão oficial do sistema, com o portal do aluno, o painel administrativo completo e a infraestrutura de segurança, presença, justificativas, financeiro e backup.',
    itens: [
      { categoria: 'novo', texto: 'Portal do aluno em formato de aplicativo: carteirinha digital, presença por GPS, frequência, financeiro, graduação, fotos, playlist e justificativas.' },
      { categoria: 'novo', texto: 'Chamada diária por exceção: lista completa do núcleo, todos começam como falta e o admin marca apenas os presentes — com edição retroativa.' },
      { categoria: 'novo', texto: 'Mural do aluno: avisos e cartazes publicados pelo painel, com controle por núcleo.' },
      { categoria: 'novo', texto: 'Backup completo automático do sistema com histórico, retenção configurável, download e restauração.' },
      { categoria: 'novo', texto: 'Recuperação de senha por código de 6 dígitos enviado por e-mail para contas do painel.' },
      { categoria: 'novo', texto: 'Sistema de versionamento e changelog oficial (esta tela).' },
      { categoria: 'seguranca', texto: 'Login único do painel com sessão assinada em cookie, verificação de permissões no servidor em todas as rotas administrativas e nenhuma credencial no frontend.' },
      { categoria: 'seguranca', texto: 'Presença do aluno validada por dia de treino, janela de horário e distância do núcleo, com auditoria unificada.' },
      { categoria: 'interface', texto: 'Identidade visual dark premium com vidro translúcido e acentos laranja em todas as telas do aluno e do painel.' },
    ],
  },
];
