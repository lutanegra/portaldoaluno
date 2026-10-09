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
 *  3. adicione a entrada desta versão NO TOPO deste array, marcando o público
 *     de cada item/versão (veja ChangelogPublico abaixo).
 */

import { APP_VERSION } from '@/lib/version';

export type ChangelogCategoria =
  | 'novo'
  | 'melhorias'
  | 'correcoes'
  | 'interface'
  | 'seguranca'
  | 'desempenho';

export type ChangelogPublico = 'todos' | 'admin';

export interface ChangelogItem {
  categoria: ChangelogCategoria;
  texto: string;
  /**
   * Público do item: 'todos' (padrão) aparece para aluno e painel;
   * 'admin' é assunto do painel/infraestrutura e NUNCA aparece no ✦ Novidades do aluno.
   */
  publico?: ChangelogPublico;
}

export interface ChangelogEntry {
  versao: string;
  data: string; // AAAA-MM-DD
  titulo: string;
  descricao: string;
  /** Descrição alternativa exibida ao aluno quando a geral cita assuntos do painel. */
  descricaoAluno?: string;
  itens: ChangelogItem[];
  /** 'admin' = versão inteiramente interna (infraestrutura/painel); oculta do aluno. */
  publico?: ChangelogPublico;
}

const itensVisiveisAoAluno = (itens: ChangelogItem[]): ChangelogItem[] =>
  itens.filter(i => i.publico !== 'admin');

/** Histórico como o ALUNO vê: sem versões internas e sem itens exclusivos do painel. */
export function changelogParaAluno(): ChangelogEntry[] {
  return CHANGELOG
    .filter(e => e.publico !== 'admin' && itensVisiveisAoAluno(e.itens).length > 0)
    .map(e => ({
      ...e,
      descricao: e.descricaoAluno ?? e.descricao,
      itens: itensVisiveisAoAluno(e.itens),
    }));
}

/** Versão de referência do indicador "novidade não vista" na visão do aluno. */
export function versaoReferenciaAluno(): string {
  return changelogParaAluno()[0]?.versao ?? APP_VERSION;
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
    versao: '1.6.7',
    data: '2026-10-09',
    titulo: 'Digitação de nome corrigida',
    descricao: 'Os campos de nome completo voltaram a aceitar espaços normalmente durante a digitação — o corretor automático de maiúsculas, que antes rodava a cada tecla e apagava o espaço recém-digitado, agora acontece apenas ao salvar. Todos os cadastros continuam sendo gravados no padrão "Nome Sobrenome".',
    descricaoAluno: 'Correção importante na criação de conta e nos cadastros: o campo de nome completo não apaga mais o espaço entre as palavras enquanto você digita. Nomes em CAIXA ALTA continuam sendo corrigidos para o padrão "Nome Sobrenome" no salvamento.',
    itens: [
      { categoria: 'correcoes', publico: 'todos', texto: 'Dar espaço nos campos de nome voltou a funcionar — na criação de conta, no cadastro de dependente e no cadastro de responsável — sem colar as palavras.' },
      { categoria: 'melhorias', publico: 'todos', texto: 'A padronização de nomes (CAIXA ALTA → "Nome Sobrenome") agora acontece no salvamento, sem interferir na digitação.' },
    ],
  },
  {
    versao: '1.6.6',
    data: '2026-10-06',
    titulo: 'Novas graduações de Estagiário',
    descricao: 'A escala adulta ganhou três cordas de Estagiário, posicionadas entre Mestrando e Mestre: Cinza e Roxa (Estagiário para Instrutor), Cinza e Marrom (Estagiário para Professor) e Cinza e Vermelha (Estagiário para Mestrando), com representação de cores própria em todo o sistema.',
    descricaoAluno: 'A escala de graduações ganhou três novas cordas adultas de Estagiário — Cinza e Roxa, Cinza e Marrom e Cinza e Vermelha —, já disponíveis para seleção e com as cores representadas na carteirinha.',
    itens: [
      { categoria: 'novo', texto: 'Novas graduações adultas de Estagiário: Cinza e Roxa (Estagiário para Instrutor), Cinza e Marrom (Estagiário para Professor) e Cinza e Vermelha (Estagiário para Mestrando), posicionadas entre Mestrando e Mestre.', publico: 'todos' },
      { categoria: 'melhorias', texto: 'As novas cordas têm cores próprias (cinza + cor da função) na barra de graduação do painel, na carteirinha e na verificação de autenticidade.', publico: 'todos' },
      { categoria: 'interface', texto: 'Selo de posto "Estagiário…" (verde-água) na listagem de alunos do painel para quem ocupa um dos novos níveis.', publico: 'admin' },
    ],
  },
  {
    versao: '1.6.5',
    data: '2026-10-03',
    titulo: 'Gestão completa de responsáveis no painel',
    descricao: 'A aba Responsáveis virou gestão completa: editar dados pessoais da conta, criar ou editar o acesso (usuário, e-mail, telefone e senha), resetar senha, vincular dependente já cadastrado, excluir acesso e remover função — tudo com sessão do painel validada no servidor.',
    descricaoAluno: 'Melhorias no painel de administração para a gestão das contas de responsáveis. Nada muda para você no app.',
    itens: [
      { categoria: 'melhorias', publico: 'admin', texto: 'Aba Responsáveis completa: ✏️ Editar dados (nome, contato e endereço), ➕ Criar acesso (usuário e senha, com matrícula automática quando o perfil é de aluno), 🔑 Editar acesso, 🔒 Resetar senha, 👨‍👩‍👧 Vincular dependente já cadastrado (busca por nome ou matrícula), Excluir acesso e Remover função.' },
      { categoria: 'correcoes', publico: 'admin', texto: 'Contas de responsável "invisíveis": quem tinha perfil de responsável criado sem a marcação de tipo na conta não aparecia na aba Responsáveis e entrava na chamada como aluna. O sistema agora detecta e classifica essas contas corretamente (caso real corrigido na base).' },
      { categoria: 'correcoes', publico: 'admin', texto: 'Chamada, relatórios de Quantitativo e Uniformes e o CSV de backup agora excluem qualquer conta que não seja um perfil de aluno de verdade (responsável sem matrícula e sem núcleo não entra mais em nenhuma lista de alunos).' },
    ],
  },
  {
    versao: '1.6.4',
    data: '2026-10-03',
    titulo: 'Relatório de Uniformes e graduação infantil corrigida',
    descricao: 'A aba Relatórios ganhou o relatório de Uniformes: lista de alunos com matrícula e todos os tamanhos lançados, pronta para gerar PDF ou imprimir para a confecção. Na edição do cadastro do painel, escolher o tipo Infantil agora mostra de fato as graduações infantis.',
    descricaoAluno: 'Melhorias no painel de administração: novo relatório de uniformes e correção na lista de graduações infantis. Nada muda para você no app.',
    itens: [
      { categoria: 'novo', publico: 'admin', texto: 'Relatório de Uniformes na aba Relatórios: escolhe o núcleo (ou todos), mostra nome, matrícula, camisa, altura, cintura e gavião da calça e as camisas do grupo/projeto, com totais de alunos com e sem medidas. O PDF sai em A4 em pé, com a logo do grupo e células em branco para quem ainda não tem medida lançada — dá para anotar à mão na hora da conferência com a confecção.' },
      { categoria: 'correcoes', publico: 'admin', texto: 'Editar Cadastro: ao selecionar o tipo de graduação Infantil, a lista mostrava apenas graduações adultas (a escolha era gravada num formato que a comparação não reconhecia). Corrigido — e trocar o tipo agora limpa a corda incompatível, como já acontece no app do aluno.' },
    ],
  },
  {
    versao: '1.6.3',
    data: '2026-10-03',
    titulo: 'Ficha de Uniforme com botão dedicado no painel',
    descricao: 'A Ficha de Uniforme agora tem um botão próprio na aba Alunos: abre a ficha do aluno com nome, matrícula e foto, e o admin preenche camisa, calça e camisas do grupo/projeto direto ali — sem passar pelo cadastro completo.',
    descricaoAluno: 'Solicitações de uniforme continuam funcionando como sempre: as medidas que você informa no pedido ficam registradas no seu cadastro para a confecção.',
    itens: [
      { categoria: 'novo', publico: 'admin', texto: 'Botão 👕 Uniforme na linha de cada aluno e na tela "Ver": abre a ficha dedicada com nome, matrícula, núcleo e foto no topo, campos de camisa (tamanho), calça (altura, cintura, gavião) e camisas do grupo/projeto, e salvamento imediato sem tocar no restante do cadastro.' },
      { categoria: 'melhorias', publico: 'admin', texto: 'A ficha já abre preenchida com as medidas colhidas na solicitação do aluno, e o que for ajustado pela administração é o mesmo dado que o app exibe.' },
    ],
  },
  {
    versao: '1.6.2',
    data: '2026-10-03',
    titulo: 'Recuperação de senha restabelecida e formulários legíveis',
    descricao: 'O fluxo "Esqueci minha senha" voltou a funcionar no painel e no app do aluno: o código chega por e-mail e a senha pode ser redefinida de ponta a ponta. Os menus de seleção do painel voltaram a mostrar o texto (fundos e cores corrigidos), e a busca de aluno em Resetar senha e Editar conta agora lista também as contas de responsável.',
    descricaoAluno: 'O "Esqueci minha senha" do app voltou a funcionar: informe seu e-mail ou usuário, receba o código e defina a nova senha. Antes, o sistema dizia "conta não encontrada" mesmo com a conta existindo.',
    itens: [
      { categoria: 'correcoes', publico: 'admin', texto: 'Resetar senha de aluno funcionando de novo na aba Contas: a ação tinha sido apagada do servidor numa revisão antiga e respondia "Ação desconhecida". Também foi restaurada a verificação do código de 6 dígitos antes de salvar a nova senha.' },
      { categoria: 'correcoes', texto: 'O "Esqueci minha senha" do app dizia "conta não encontrada" para qualquer conta: o campo digitado viajava com um nome que o servidor não lia. Corrigido — o código de recuperação volta a ser enviado e a senha redefinida.' },
      { categoria: 'interface', publico: 'admin', texto: 'Menus de seleção do painel estavam com fundo e texto brancos ao mesmo tempo (impossível ler as opções). Corrigido de forma global: todas as listas do sistema agora usam as cores do app, dentro e fora da lista aberta.' },
      { categoria: 'melhorias', publico: 'admin', texto: 'Resetar senha e Editar conta agora listam todas as contas de acesso, incluindo as de responsável — antes só apareciam alunos.' },
    ],
  },
  {
    versao: '1.6.1',
    data: '2026-10-03',
    titulo: 'Termo só com cadastro completo e fim das contas duplicadas',
    descricao: 'O Termo de Responsabilidade agora só pode ser iniciado com o cadastro do aluno completo (com salvamento automático dos dados antes de assinar), e nenhuma conta pode mais ser criada com o nome de outra — inclusive quando o responsável cadastra um dependente.',
    descricaoAluno: 'O Termo de Responsabilidade agora só abre depois que o cadastro do aluno está completo, salvando automaticamente o que foi digitado antes de assinar. Também não é mais possível criar uma segunda conta com o mesmo nome de um aluno já cadastrado — o sistema orienta a vincular a conta existente. Nomes passam a ser gravados sempre no padrão "Nome Sobrenome", e os que estavam em maiúsculas já foram corrigidos.',
    itens: [
      { categoria: 'correcoes', texto: 'O botão do termo não falha mais ao ser tocado antes de terminar o cadastro: enquanto faltar qualquer dado obrigatório (nome, CPF, RG, nascimento ou núcleo), o termo fica indisponível com um aviso dizendo exatamente o que falta e um atalho para Meus Dados.' },
      { categoria: 'melhorias', texto: 'Ao confirmar o termo, os dados preenchidos em Meus Dados são salvos automaticamente antes da assinatura — o documento sai com as informações atualizadas, sem precisar voltar e salvar à mão.' },
      { categoria: 'seguranca', texto: 'O servidor também recusa o termo com cadastro incompleto (a validação não depende só do botão), não gera termo repetido para quem já assinou e confirma que o aluno é mesmo menor de idade antes de aceitar a assinatura.' },
      { categoria: 'seguranca', texto: 'Nenhuma conta nova pode ser criada com o mesmo nome de um cadastro existente — vale para a criação de dependente pelo responsável e para o restante do app. No lugar de duplicar, o sistema orienta usar o código de vínculo da conta que já existe. CPF repetido também é bloqueado na criação de dependente.' },
      { categoria: 'melhorias', texto: 'Nomes passam a ser gravados sempre no padrão "Nome Sobrenome" — quem digitar em CAIXA ALTA tem o nome corrigido automaticamente ao salvar, em todas as telas.' },
    ],
  },
  {
    versao: '1.6.0',
    data: '2026-10-03',
    titulo: 'Ficha de Uniforme do aluno',
    descricao: 'Nova função administrativa: as medidas do uniforme de cada aluno (camisa, calça e camisas do grupo/projeto) ficam vinculadas ao cadastro, lançadas pelo painel — e são colhidas automaticamente quando o aluno solicita um uniforme.',
    itens: [
      { categoria: 'novo', publico: 'admin', texto: 'Painel: no Editar Cadastro, nova seção "Uniforme" junto da graduação — tamanho da camisa, altura, cintura e gavião da calça, e tamanhos da camisa do grupo e do projeto. Os dados aparecem no botão "Ver" do aluno e na visualização completa do aluno.' },
      { categoria: 'novo', texto: 'Ao solicitar um uniforme na aba financeiro, o aluno agora também informa as medidas (podendo deixar em branco o que já está no cadastro); o que preencher é salvo automaticamente no cadastro para a confecção.' },
      { categoria: 'melhorias', publico: 'admin', texto: 'Painel: ao abrir a solicitação de uniforme, o formulário do aluno já vem preenchido com as medidas salvas, evitando redigitar.' },
    ],
  },
  {
    versao: '1.5.5',
    data: '2026-10-02',
    titulo: 'Folha de Chamada para assinatura em papel',
    descricao: 'Novo documento na aba Presenças: a lista dos alunos do núcleo em ordem alfabética, cada um com campo para assinar — pronta para imprimir ou salvar em PDF.',
    descricaoAluno: undefined,
    itens: [
      { categoria: 'novo', publico: 'admin', texto: 'Painel: botão "Folha de Chamada" na aba Presenças gera o documento oficial do núcleo — topo com título, nome do grupo, nome do núcleo e espaço para a data, seguido da lista de alunos cadastrados em ordem alfabética com campo de assinatura ao lado de cada nome. Quando a lista não cabe em uma folha, o documento continua nas páginas seguintes repetindo o cabeçalho da tabela.' },
      { categoria: 'melhorias', publico: 'admin', texto: 'Painel: a folha ainda traz o total de alunos, campos para o total de presenças e ausências do dia e uma linha de identificação do professor/responsável ao pé do documento.' },
    ],
  },
  {
    versao: '1.5.4',
    data: '2026-10-02',
    titulo: 'Presença sempre validada — dia, horário e local valendo para todos',
    descricao: 'Corrigido o furo que permitia registrar presença fora do dia/horário/local quando o aparelho tinha uma sessão de administrador aberta (ex.: painel no mesmo navegador), e a conferência de GPS voltou a valer no registro.',
    descricaoAluno: 'A presença agora é sempre conferida pelo servidor — dia de treino, horário e local do seu núcleo — mesmo que o aparelho já tenha sido usado para acessar a área da administração.',
    itens: [
      { categoria: 'seguranca', texto: 'Fechado o furo: abrir o app do aluno no mesmo navegador do painel fazia o servidor tratar o aluno como administrador e pular TODAS as travas (dia, horário e local). A validação agora vale para todo aluno, sempre.' },
      { categoria: 'correcoes', texto: 'A conferência de local não estava atuando: o GPS do celular não chegava na validação, o que bloquearia todo aluno de verdade. Agora a distância até o núcleo é medida no momento do registro (raio de 200 m), e sem permissão de localização a presença não é aceita.' },
      { categoria: 'melhorias', publico: 'admin', texto: 'Painel: os registros feitos pela administração (fila offline, desfazer exclusão e presença pela ficha do aluno) continuam sem travas, agora identificados explicitamente como operação do painel — com auditoria correta de quem registrou.' },
      { categoria: 'melhorias', publico: 'admin', texto: 'Painel: a aba Relatórios ganhou um menu de relatórios — além de Presenças e Frequência, agora há o Quantitativo de Alunos para prestação de contas, com escolha de núcleo ou todos.' },
      { categoria: 'novo', publico: 'admin', texto: 'Relatório Quantitativo: totais de alunos, maiores e menores de idade sempre coerentes com o filtro escolhido, média e distribuição por faixa etária em gráficos, e lista completa com nome, idade, nascimento, CPF e — para menores — nome e CPF do responsável. Gera documento (PDF/impressão) com o nome do grupo e a data de geração no topo.' },
    ],
  },
  {
    versao: '1.5.3',
    data: '2026-10-02',
    titulo: 'Termo correto em cada conta e horário de treino valendo de verdade',
    descricao: 'Ao trocar de conta ou perfil, o app recalcula o status do termo (não herda mais o "assinado" da conta anterior), e a trava de horário da presença passa a usar a janela realmente cadastrada pelo núcleo — início e término.',
    descricaoAluno: 'Ao trocar de conta ou perfil, o termo de cada aluno agora aparece com o status certo (não herda mais o "assinado" de outra conta), e a presença passa a respeitar de verdade o horário do treino do seu núcleo.',
    itens: [
      { categoria: 'correcoes', texto: 'Corrigido: ao criar/entrar em outra conta no mesmo dispositivo, o termo aparecia como "já assinado" com a assinatura de outra conta de teste — o estado era herdado do perfil anterior. Agora o status e a assinatura são recalculados a cada troca.' },
      { categoria: 'correcoes', texto: 'A trava de horário da presença não estava sendo aplicada: o servidor lia um formato antigo de horário que nenhum núcleo usava. Agora vale a janela real — presença aceita de X min antes do início até X min depois do término (tolerância do núcleo). Sem horário cadastrado, segue liberada no dia de treino inteiro.' },
      { categoria: 'melhorias', publico: 'admin', texto: 'Gerenciar Núcleo: além do horário de início, agora cada dia de treino tem horário de TÉRMINO — os dois alimentam a janela de presença junto com a tolerância.' },
    ],
  },
  {
    versao: '1.5.2',
    data: '2026-10-02',
    titulo: 'Termo mais claro e horário de treino sob controle',
    descricao: 'Avisos do termo agora mostram exatamente o que falta antes de assinar, e o núcleo passa a definir horário e tolerância para o registro de presença.',
    descricaoAluno: 'Avisos do termo agora mostram exatamente o que falta antes de assinar, e a presença respeita o dia e o horário do treino do seu núcleo.',
    itens: [
      { categoria: 'correcoes', texto: 'A caixa de aviso do termo (abaixo da data de nascimento) não insistia depois que o termo era assinado — agora ela vira confirmação verde "termo assinado".' },
      { categoria: 'melhorias', texto: 'Ao assinar o termo sem o núcleo preenchido, o app agora avisa "Falta preencher o Núcleo em Meus Dados" em vez de um erro genérico — no app e no link que o responsável recebe.' },
      { categoria: 'novo', texto: 'Presença agora respeita também o HORÁRIO do treino: enquanto os núcleos não tiverem horário cadastrado, segue liberada no dia de treino inteiro (comportamento de antes, sem mudança silenciosa).' },
      { categoria: 'melhorias', publico: 'admin', texto: 'Gerenciar Núcleo ganhou horário por dia de treino e tolerância de presença (0–120 min, padrão 15) — salvos no núcleo e aplicados na trava de presença do aluno.' },
    ],
  },
  {
    versao: '1.5.1',
    data: '2026-10-02',
    titulo: 'Condições atípicas visíveis na aba Alunos',
    descricao:
      'O painel passa a mostrar exatamente quais condições de desenvolvimento atípico o aluno marcou em Meus Dados — no selo da lista, nos detalhes e ao editar o cadastro, unificando o que o aluno e a administração marcaram.',
    publico: 'admin',
    itens: [
      { categoria: 'novo', texto: 'No modal de detalhes do aluno, o selo 🧩 de condições atípicas agora abre a lista completa: mostra quais condições o aluno marcou em Meus Dados, junto com as registradas pela administração.' },
      { categoria: 'correcoes', texto: 'As condições marcadas pelo aluno no app apareciam apenas na contagem da lista — agora entram também no modal de edição, sem risco de serem sobrescritas ao salvar o cadastro.' },
    ],
  },
  {
    versao: '1.5.0',
    data: '2026-10-02',
    titulo: 'Contas de responsável: estrutura completa e termos desbloqueados',
    descricao:
      'A conta de responsável ficou com regras claras: quem não é aluno não ganha matrícula nem campos de treino; o cadastro do dependente é gerenciado pelo perfil dele; e a assinatura do Termo volta a funcionar em todos os caminhos, com o documento salvo na conta do aluno e liberado para salvar em PDF.',
    descricaoAluno:
      'Contas de responsável com regras mais claras, correção da assinatura do Termo de Responsabilidade e do salvamento de dados — e o termo assinado agora pode ser salvo em PDF na hora.',
    itens: [
      { categoria: 'correcoes', texto: 'Assinar o Termo de Responsabilidade funciona de novo em todos os caminhos: pelo responsável no perfil do dependente, pelo aluno menor que preenche os dados do responsável e pelo link de assinatura. O erro "Erro ao salvar" veio de exigências que se contradiziam.' },
      { categoria: 'novo', texto: 'Depois de assinar, o termo pode ser salvo em PDF / impresso direto da tela de confirmação — com a assinatura desenhada no documento.' },
      { categoria: 'correcoes', texto: 'Contas criadas como "somente responsável" deixam de receber matrícula de aluno (CCLN-000) e não veem núcleo, graduação ou campos de treino no próprio cadastro — apenas dados pessoais.' },
      { categoria: 'correcoes', texto: '"Excluir minha conta" voltou a funcionar no app, e o responsável com dependentes ativos mantém os vínculos deles ao sair.' },
      { categoria: 'correcoes', texto: 'O formulário do responsável agora salva o cadastro completo do dependente (núcleo, documentos, endereço), sem apagar o que já estava preenchido.' },
      { categoria: 'novo', publico: 'admin', texto: 'Nova aba "Responsáveis" no painel: todas as contas de responsável com tipo, núcleo, matrícula (quando houver), dependentes vinculados, situação do acesso e ações de excluir acesso / remover função.' },
      { categoria: 'correcoes', publico: 'admin', texto: 'Exclusão definitiva de aluno na aba Alunos voltou a funcionar (a rota tinha sido removida sem querer) — mantendo o snapshot na lixeira e a confirmação por senha.' },
      { categoria: 'correcoes', publico: 'admin', texto: 'No cadastro do aluno menor, o admin passa a visualizar o termo assinado (com a assinatura) direto do modal de detalhes.' },
      { categoria: 'seguranca', publico: 'admin', texto: 'Exclusões destrutivas passam a exigir confirmação explícita validada no servidor.' },
    ],
  },
  {
    versao: '1.4.4',
    data: '2026-10-02',
    titulo: 'Perfil do dependente: salvar dados e assinar termo funcionando',
    descricao:
      'Com o perfil do dependente aberto, completar cadastro, assinar o Termo, registrar presença e gerenciar arquivos e financeiro passam a agir sobre o perfil aberto — antes, tudo ia para a conta do responsável e falhava sem explicação.',
    itens: [
      { categoria: 'correcoes', texto: 'Ao completar o cadastro do dependente, todos os campos são salvos de verdade — antes só nome, e-mail e alguns dados persistiam.' },
      { categoria: 'correcoes', texto: 'Assinar o Termo de Responsabilidade do dependente volta a funcionar: o erro "Erro ao salvar, tente novamente" vinha de uma exigência impossível (o termo teria de estar assinado antes de poder ser assinado).' },
      { categoria: 'correcoes', texto: 'Presença, justificativas, documentos, fotos, playlist, evolução e ficha financeira acompanham o perfil aberto no "Quem está usando?".' },
      { categoria: 'correcoes', texto: 'O formulário do responsável não apaga mais dados que o dependente ou a administração já haviam preenchido — só atualiza o que for informado.' },
      { categoria: 'seguranca', texto: 'A assinatura do termo agora é validada no servidor: uma conta só assina para si mesma ou para um dependente com vínculo ativo.' },
    ],
  },
  {
    versao: '1.4.3',
    data: '2026-10-02',
    titulo: 'Conta de responsável corrigida: perfis e dependentes funcionando',
    descricao:
      'A área "Responsáveis & Perfis" voltou a funcionar — agora com botão próprio para criar o perfil do dependente (a criança recebe matrícula e já nasce vinculada). A conta de responsável não exibe mais matrícula de aluno: o painel inicial mostra os dependentes com botão para abrir cada um.',
    itens: [
      { categoria: 'correcoes', texto: 'A seção "Responsáveis & Perfis" carrega novamente — criação de perfil de responsável, dependentes, solicitações de acesso e autorização de adolescente estavam fora do ar.' },
      { categoria: 'novo', texto: 'Na mesma seção (e no painel inicial do responsável), botão destacado "Criar perfil do meu dependente": cadastra a criança com matrícula automática, já vinculada, sem precisar de outra conta.' },
      { categoria: 'correcoes', texto: 'A conta de responsável não é mais tratada como aluno: sem matrícula/graduação indevidas na tela e com lista dos dependentes no painel inicial, com botão para abrir cada perfil.' },
      { categoria: 'correcoes', texto: 'Ações desconhecidas do app não são mais confundidas com tentativa de login (as mensagens de "usuário ou senha incorretos" em telas erradas sumiram).' },
      { categoria: 'seguranca', texto: 'Regras de quem pode gerar código de vínculo, vincular, aprovar e revogar dependentes continuam válidadas no servidor, como antes.' },
    ],
  },
  {
    versao: '1.4.2',
    data: '2026-10-01',
    titulo: 'Cadastro completo logo após criar a conta',
    descricao:
      'Depois de criar a conta, a tela "Meus Dados" abre já preenchida com o que foi informado no cadastro — data de nascimento, telefone e e-mail —, o ID (CCLN-000) aparece sozinho e o aviso de Termo surge imediatamente para menores de 18.',
    itens: [
      { categoria: 'correcoes', texto: 'Ao terminar o cadastro (ou entrar na conta), os dados já preenchidos aparecem na tela "Meus Dados" sem precisar recarregar a página.' },
      { categoria: 'correcoes', texto: 'O ID do aluno (CCLN-000) passa a aparecer na hora — inclusive no primeiro acesso, antes de qualquer salvamento.' },
      { categoria: 'correcoes', texto: 'O aviso de "Menor de idade — Termo obrigatório" surge imediatamente quando a data de nascimento informa menoridade.' },
      { categoria: 'correcoes', texto: 'A assinatura desenhada pelo responsável aparece novamente no documento do Termo para impressão/PDF — antes o espaço saía em branco.' },
      { categoria: 'seguranca', texto: 'Sair da conta agora limpa também o perfil aberto no dispositivo: o próximo login desta tela não herda o acesso de quem saiu antes.' },
    ],
  },
  {
    versao: '1.4.1',
    data: '2026-10-01',
    titulo: 'Correções no cadastro e salvamento de dados',
    descricao:
      'A criação de conta voltou a funcionar: todos os dados do formulário são salvos e o número de matrícula é gerado automaticamente. Cadastros feitos pelo painel e pelo aluno voltaram a salvar de verdade — inclusive núcleo e data de nascimento.',
    itens: [
      { categoria: 'correcoes', texto: 'Criação de conta de aluno e de responsável restaurada: nome, e-mail, telefone, data de nascimento e CPF são gravados e a conta nasce logada.' },
      { categoria: 'correcoes', texto: 'Editar cadastro no painel salva novamente todas as informações — havia um bloqueio de segurança do banco que impedia a gravação sem avisar.', publico: 'admin' },
      { categoria: 'correcoes', texto: 'Núcleo escolhido na edição volta a ficar salvo no aluno.', publico: 'admin' },
      { categoria: 'correcoes', texto: 'Data de nascimento não desaparece mais do formulário de edição ao reabrir o cadastro salvo.', publico: 'admin' },
      { categoria: 'seguranca', texto: 'Regra de proteção de dados do banco complementada para permitir exatamente as gravações do painel — nada além disso.', publico: 'admin' },
    ],
  },
  {
    versao: '1.4.0',
    data: '2026-10-01',
    titulo: 'Entrada direta no app, Novidades no sino e assinatura eletrônica no termo',
    descricao:
      'Quem já tem conta agora entra direto no app, sem digitar senha de novo, e o sino de notificações ganhou acesso às novidades. O Termo de Responsabilidade passou a pedir a assinatura eletrônica do responsável, que aparece no documento para impressão/PDF junto com o nome do grupo.',
    itens: [
      { categoria: 'novo', texto: 'Login permanente: com a conta já criada, o app abre direto no seu perfil — a sessão se renova a cada visita e você só digita senha novamente se sair da conta.' },
      { categoria: 'novo', texto: 'O responsável assina o Termo de Responsabilidade com assinatura eletrônica desenhada na tela, registrada com data e identificação do dispositivo.' },
      { categoria: 'melhorias', texto: 'O sino de notificações agora tem a aba ✦ Novidades — o histórico de atualizações fica a um toque dentro do app (o botão continua na tela de login).' },
      { categoria: 'melhorias', texto: 'O documento do termo para imprimir/PDF sai com a assinatura do responsável e o nome do grupo (Centro Cultural Luta Negra) no lugar do nome da plataforma.' },
    ],
  },
  {
    versao: '1.3.3',
    data: '2026-10-01',
    titulo: 'Histórico de novidades separado por público',
    descricao:
      'O ✦ Novidades do aluno passa a mostrar somente o que interessa a quem treina: implementações novas, correções de bugs do app e mudanças de segurança. Assuntos internos de infraestrutura e recursos exclusivos do painel administrativo ficam apenas no histórico completo, visível só a administradores na aba Versões do painel.',
    descricaoAluno:
      'As novidades que você vê aqui agora mostram somente o que importa para quem treina — recursos novos, correções e segurança. Assuntos internos de manutenção e do painel administrativo não aparecem mais nesta lista.',
    itens: [
      { categoria: 'melhorias', texto: 'O ✦ Novidades do aluno exibe apenas mudanças relevantes para quem treina: recursos novos, correções e segurança.', publico: 'todos' },
      { categoria: 'melhorias', texto: 'Assuntos internos de manutenção e recursos do painel administrativo ficam restritos ao histórico completo dos admins (aba Versões).', publico: 'admin' },
    ],
  },
  {
    versao: '1.3.2',
    data: '2026-10-01',
    titulo: 'Correção do erro de instalação no deploy',
    publico: 'admin',
    descricao:
      'O deploy falhava na etapa de instalação das dependências por um conflito entre as definições de tipos do React: uma estava travada numa versão anterior à que a outra exige. As versões foram alinhadas para instalar de forma compatível em qualquer gerenciador de pacotes.',
    itens: [
      { categoria: 'correcoes', texto: 'Deploy volta a concluir a instalação das dependências: versões das definições de tipos do React alinhadas, eliminando o conflito que derrubava a publicação.' },
    ],
  },
  {
    versao: '1.3.1',
    data: '2026-10-01',
    titulo: 'Correção do Termo para menores e do painel de notificações',
    descricao:
      'O Termo de Responsabilidade dizia "não aplicável" para alunos menores de idade porque a tela usava uma marcação antiga do cadastro em vez da data de nascimento. O painel de notificações também abria espremido na altura do cabeçalho.',
    itens: [
      { categoria: 'correcoes', texto: 'Termo de Responsabilidade volta a aparecer para menores: a verificação agora parte sempre da data de nascimento, tanto na aba do app quanto na página do termo.' },
      { categoria: 'correcoes', texto: 'Painel de notificações abre em tela cheia, sobre todo o app, em vez de ficar preso dentro do cabeçalho — a lista volta a ser navegável.' },
      { categoria: 'interface', texto: 'Notificações: fechar com a tecla Esc e o painel acompanha a largura do celular.' },
    ],
  },
  {
    versao: '1.3.0',
    data: '2026-10-01',
    titulo: 'Notificações Push reais, central de notificações e preferências',
    descricao:
      'O Ginga Gestão agora envia push de verdade para o celular — mesmo com o app fechado — além de manter um histórico completo dentro do app, com sino, preferências por categoria e gerenciamento de dispositivos.',
    itens: [
      { categoria: 'novo', texto: 'Notificações push reais: avisos chegam na tela do celular com o Ginga Gestão fechado, e tocar na notificação abre o app direto no conteúdo.' },
      { categoria: 'novo', texto: 'Sino de notificações no app do aluno e no painel, com contador de não lidas, histórico, marcar como lida e abrir a origem.' },
      { categoria: 'novo', texto: 'Central de configuração com preferências por categoria: mural, eventos, presença, justificativas, graduação, responsáveis e sistema.' },
      { categoria: 'novo', texto: 'Notificações de conta e segurança são sempre ativas (novo login, troca de senha, recuperação de conta) — não podem ser desligadas.' },
      { categoria: 'novo', texto: 'Gerenciamento de dispositivos: veja onde o push está ativo, envie notificação de teste e desative dispositivos individualmente.' },
      { categoria: 'melhorias', texto: 'Mural: nova publicação pode notificar alunos e responsáveis (checkbox no formulário), respeitando os núcleos etiquetados.', publico: 'admin' },
      { categoria: 'melhorias', texto: 'Eventos, faltas da chamada, justificativas (envio e decisão) e graduações agora geram notificações para quem tem direito.' },
      { categoria: 'melhorias', texto: 'Responsáveis recebem novidades dos dependentes com vínculo ativo — solicitação, aprovação, recusa e revogação.' },
      { categoria: 'seguranca', texto: 'Chaves de envio ficam só no servidor; dispositivos são revogados no logout e troca de conta no mesmo navegador.' },
      { categoria: 'seguranca', texto: 'Preferências e obrigatoriedade validadas no servidor; nenhuma notificação sai sem permissão da categoria ou vínculo ativo.' },
      { categoria: 'desempenho', texto: 'Envios em lote isolados por dispositivo: falha de um não interrompe os demais, e dispositivos expirados são desativados sozinhos.', publico: 'admin' },
    ],
  },
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
      'O botão "Criar conta" agora pergunta quem você é antes de tudo: responsável (com ou sem perfil de aluno) ou aluno. No painel, corrigidos o seletor de núcleos que aparecia vazio para admin de núcleo no mural e o login pelo portal do núcleo, que salvava só o núcleo principal.',
    descricaoAluno:
      'O botão "Criar conta" agora pergunta quem você é antes de tudo: responsável (com ou sem perfil de aluno) ou aluno, com uma breve descrição do que cada conta faz.',
    itens: [
      { categoria: 'novo', texto: 'Escolha do tipo de conta ao criar login: "Sou responsável" ou "Sou aluno", com descrição do que cada uma faz.' },
      { categoria: 'novo', texto: 'Conta de responsável pergunta se você também treina: uma única conta pode ter os dois perfis, ou ser só de responsável.' },
      { categoria: 'melhorias', texto: 'Responsável puro vê um app enxuto, sem abas de treino (carteirinha, presença, graduação), e o menu lateral mostra "Meu perfil · Responsável".' },
      { categoria: 'correcoes', texto: 'Mural do aluno: os núcleos voltaram a aparecer no "Exibir para" para admin de núcleo — era um erro de identificação entre nome e código do núcleo.', publico: 'admin' },
      { categoria: 'correcoes', texto: 'Login pelo portal do núcleo volta a salvar todos os núcleos que a conta gerencia, não só o principal.', publico: 'admin' },
      { categoria: 'correcoes', texto: 'Contas de responsável sem perfil de aluno não aparecem mais nas listas de alunos, na chamada diária nem no backup de alunos.', publico: 'admin' },
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
      { categoria: 'novo', texto: 'Painel: nova seção Responsáveis & Autorizações na aba Contas Alunos, com aprovação de vínculos, revogação, termo assinado e registro de autorização presencial.', publico: 'admin' },
      { categoria: 'seguranca', texto: 'Todas as APIs do aluno (dados, presença, justificativas, financeiro, documentos, mídia, playlist, evolução, histórico e matrícula) agora resolvem a identidade no servidor — alterar o ID na requisição não dá acesso a outro aluno.' },
      { categoria: 'seguranca', texto: 'Revogação de vínculo ou autorização bloqueia o acesso imediatamente, com histórico preservado para auditoria.' },
      { categoria: 'interface', texto: 'Área do Aluno (visualização), Contas Alunos e Alunos repaginadas: emojis de botão viraram rótulos/ícones, cores sólidas claras viraram vidro escuro com âmbar e as colunas do painel empilham no celular.', publico: 'admin' },
      { categoria: 'correcoes', texto: 'Backup completo passa a incluir responsáveis, vínculos e autorizações — restauração devolve tudo.', publico: 'admin' },
    ],
  },
  {
    versao: '1.1.0',
    data: '2026-10-01',
    titulo: 'Mural multi-núcleo, Minha Conta corrigida e padronização visual',
    descricao:
      'Correções nos fluxos do painel para contas que gerenciam vários núcleos e varredura de padronização visual no painel: menos emojis, mais ícones de traço, e o mesmo vidro escuro com acento laranja em todas as telas.',
    descricaoAluno:
      'Os avisos do mural chegam agora com o nome correto de quem publicou, e o app segue o mesmo visual em todas as telas.',
    itens: [
      { categoria: 'correcoes', texto: 'Mural: avisos voltaram a salvar para admin de núcleo (erro "não autorizado" / "sessão expirada" eliminado) e o nome de quem publicou agora aparece sempre correto.', publico: 'admin' },
      { categoria: 'novo', texto: 'Mural: seleção múltipla de núcleos — o aviso pode ser exibido para vários núcleos de uma vez; admin de núcleo vê apenas os núcleos que gerencia.', publico: 'admin' },
      { categoria: 'correcoes', texto: 'Gerenciar Núcleos: conta com mais de um núcleo agora enxerga e edita todos, não só o principal.', publico: 'admin' },
      { categoria: 'correcoes', texto: 'Minha Conta: nome de exibição em todo o painel passa a ser o nome do admin (não mais o do núcleo); CPF continua salvo ao editar outros dados e o e-mail de recuperação aparece corretamente.', publico: 'admin' },
      { categoria: 'interface', texto: 'Gerenciar Núcleos, Minha Conta, Config. E-mail e Área do Aluno (visualização) repaginados no padrão dark premium com ícones de traço no lugar de emojis.', publico: 'admin' },
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
      { categoria: 'seguranca', texto: 'Login único do painel com sessão assinada em cookie, verificação de permissões no servidor em todas as rotas administrativas e nenhuma credencial no frontend.', publico: 'admin' },
      { categoria: 'seguranca', texto: 'Presença do aluno validada por dia de treino, janela de horário e distância do núcleo, com auditoria unificada.' },
      { categoria: 'interface', texto: 'Identidade visual dark premium com vidro translúcido e acentos laranja em todas as telas do aluno e do painel.' },
    ],
  },
];
