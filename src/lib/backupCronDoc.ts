/**
 * Documentação do agendador externo — centralizada para a página de instrução
 * e para o painel (sem expor o valor real do segredo, apenas o nome dele).
 */
export const CRON_SETUP_DOC = {
  endpoint: '/api/admin/backup-cron',
  passos: [
    'Crie a variável de ambiente <strong>BACKUP_CRON_SECRET</strong> no provedor de hospedagem (qualquer texto longo e aleatório).',
    'No serviço de agendamento (cron-job.org, EasyCron, GitHub Actions ou Vercel Cron), cadastre uma chamada <strong>GET de hora em hora</strong> para o endereço acima.',
    'No serviço, configure o cabeçalho <strong>Authorization</strong> com o valor <code>Bearer SEU_BACKUP_CRON_SECRET</code>.',
    'Pronto: o servidor decide sozinho se já chegou a hora da cópia (frequência e horário definidos no painel, fuso de Brasília).',
  ],
};
