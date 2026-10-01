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
    versao: '1.2.2',
    data: '2026-10-01',
    titulo: 'Correção do cálculo de idade e do salvamento de dados',
    descricao:
      'Aluna menor de idade via o aviso de "maior de idade, sem termo" porque a idade era calculada com mês e ano invertidos. A data de nascimento também não reaparecia no formulário após salvar. Ambos corrigidos, com a idade calculada agora por uma única função em todo o sistema.',
    itens: [
      { categoria: 'correcoes', texto: 'Idade calculada com mês e ano trocados: alunos de até 17 anos podiam aparecer como "maior de idade" e dispensados do Termo de Responsabilidade. O termo voltou a ser exigido.' },
      { categoria: 'correcoes', texto: 'Data de nascimento reaparece preenchida em Meus Dados depois de salvar — era gravada com horário e o campo de data não aceitava o formato.' },
      { categoria: 'correcoes', texto: 'Conta criada pelo cadastro com CPF agora recalcula a menoridade pela data informada, em vez de manter o valor antigo do cadastro.' },
      { categoria: 'correcoes', texto: 'Alertas do formulário de dados voltaram a respeitar o aniversário do aluno (aviso de termo obrigatório aparecia um ano antes da hora).' },
      { categoria: 'melhorias', texto: 'Uma única função central calcula idade em todo o sistema (cadastro, termo, painel, backup e lista de pendências) — sem risco de contas divergentes.' },
      { categoria: 'seguranca', texto: 'CPF incompleto identificado e corrigido no banco: um cadastro tinha 10 dígitos, o que impedia a validação e o salvamento do documento.' },
    ],
  },
  {
    versao: '1.2.1',
    data: '2026-10-02',
    titulo: 'Caminho para criar conta de responsável e correções de núcleos',
    descricao:
      'O botão "Criar conta" agora pergunta quem você é antes de tudo: responsável (com ou sem perfil de aluno) ou aluno. Corrige também o seletor de núcleos que aparecia vazio para admins de núcleo no mural e no login pelo portal do núcleo.',
    itens: [
      { categoria: 'novo', texto: 'Escolha do tipo de conta ao criar login: "Sou responsável" ou "Sou aluno", com descrição do que cada uma faz.' },
      { categoria: 'novo', texto: 'Conta de responsável pergunta se você também treina: uma única conta pode ter os dois perfis, ou ser só de responsável.' },
      { categoria: 'melhorias', texto: 'Responsável puro vê um app enxuto, sem abas de treino (carteirinha, presença, graduação), e o menu lateral mostra "Meu perfil · Responsável".' },
      { categoria: 'correcoes', texto: 'Mural do aluno: os núcleos voltaram a aparecer no "Exibir para" para admin de núcleo — era um erro de identificação entre nome e código do núcleo.' },
      { categoria: 'correcoes', texto: 'Login pelo portal do núcleo volta a salvar todos os núcleos que a conta gerencia, não só o principal.' },
      { categoria: 'correcoes', texto: 'Contas de responsável sem perfil de aluno não aparecem mais nas listas de alunos, na chamada diária nem no backup de alunos.' },
    ],
  },
  {
    versao: '1.2.0',
    data: '2026-10-02',
    titulo: 'Responsáveis, tutelados e autorização de adolescentes',
    descricao:
      'O sistema agora separa conta, perfil de aluno e perfil de responsável: crianças podem ser cadastradas sem login próprio, adolescentes de 15 a 17 criam conta com autorização do responsável e adultos podem gerenciar tutelados — tudo validado no servidor.',
    itens: [
      { categoria: 'novo', texto: 'Perfis de responsável: o adulto ativa a função com o próprio CPF e adiciona tutelados por código de autorização + matrícula — sem procurar aluno por nome e sem criar contas para menores.' },
      { categoria: 'novo', texto: 'Cadastro por idade: menores de 15 não podem criar conta (recebem orientação para o responsável cadastrar); de 15 a 17 a conta exige autorização; a partir de 18, cadastro livre.' },
      { categoria: 'novo', texto: 'Termo de Autorização de Adolescente com código enviado ao e-mail do responsável, aceite marcado, assinatura eletrônica desenhada e documento final com hash guardado em local privado.' },
      { categoria: 'novo', texto: '"Quem está usando?": o responsável alterna entre o próprio perfil e os tutelados pelo menu, com aviso visual de em quem está agindo; a identidade logada não muda.' },
      { categoria: 'novo', texto: 'Responsável envia justificativas e solicitações financeiras em nome do tutelado — o registro guarda qual conta enviou.' },
      { categoria: 'novo', texto: 'Painel: nova seção Responsáveis & Autorizações na aba Contas Alunos, com aprovação de vínculos, revogação, termo assinado e registro de autorização presencial.' },
      { categoria: 'seguranca', texto: 'Todas as APIs do aluno (dados, presença, justificativas, financeiro, documentos, mídia, playlist, evolução, histórico e matrícula) agora resolvem a identidade no servidor — alterar o ID na requisição não dá acesso a outro aluno.' },
      { categoria: 'seguranca', texto: 'Revogação de vínculo ou autorização bloqueia o acesso imediatamente, com histórico preservado para auditoria.' },
      { categoria: 'interface', texto: 'Área do Aluno (visualização), Contas Alunos e Alunos repaginadas: emojis de botão viraram rótulos/ícones, cores sólidas claras viraram vidro escuro com âmbar e as colunas do painel empilham no celular.' },
      { categoria: 'correcoes', texto: 'Backup completo passa a incluir responsáveis, vínculos e autorizações — restauração devolve tudo.' },
    ],
  },
  {
    versao: '1.1.0',
    data: '2026-10-01',
    titulo: 'Mural multi-núcleo, Minha Conta corrigida e padronização visual',
    descricao:
      'Correções nos fluxos do painel para contas que gerenciam vários núcleos e varredura de padronização visual: menos emojis, mais ícones de traço, e o mesmo vidro escuro com acento laranja em todas as telas.',
    itens: [
      { categoria: 'correcoes', texto: 'Mural: avisos voltaram a salvar para admin de núcleo (erro "não autorizado" / "sessão expirada" eliminado) e o nome de quem publicou agora aparece sempre correto.' },
      { categoria: 'novo', texto: 'Mural: seleção múltipla de núcleos — o aviso pode ser exibido para vários núcleos de uma vez; admin de núcleo vê apenas os núcleos que gerencia.' },
      { categoria: 'correcoes', texto: 'Gerenciar Núcleos: conta com mais de um núcleo agora enxerga e edita todos, não só o principal.' },
      { categoria: 'correcoes', texto: 'Minha Conta: nome de exibição em todo o painel passa a ser o nome do admin (não mais o do núcleo); CPF continua salvo ao editar outros dados e o e-mail de recuperação aparece corretamente.' },
      { categoria: 'interface', texto: 'Gerenciar Núcleos, Minha Conta, Config. E-mail e Área do Aluno (visualização) repaginados no padrão dark premium com ícones de traço no lugar de emojis.' },
      { categoria: 'interface', texto: 'Documentos Históricos com nova aparência consistente e barra de documentos duplicada removida da visualização do aluno.' },
    ],
  },
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
