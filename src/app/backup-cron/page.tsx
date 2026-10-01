import { CRON_SETUP_DOC } from '@/lib/backupCronDoc';

/**
 * Página de instrução do agendador externo.
 * Visível publicamente mas sem expor nada sensível (o segredo real fica no
 * ambiente do servidor; o painel mostra como configurá-lo).
 * Acesso restrito à sessão do painel quando consultado com ?api=1 — para o
 * painel exibir o endpoint exato. Aqui só documentamos os passos.
 */
export const dynamic = 'force-dynamic';

export default function BackupCronDocPage() {
  return (
    <main style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', padding: '40px 20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-portal-aluno.png" alt="" width={28} height={28} />
          <h1 style={{ fontSize: '1.2rem', margin: 0 }}>Agendamento do backup automático</h1>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#a3a3a3', lineHeight: 1.6 }}>
          O sistema já executa backups automáticos sozinho quando o painel é usado (rede de segurança).
          Para garantir a execução <strong style={{ color: '#FF9200' }}>mesmo com ninguém acessando</strong>,
          cadastre um agendador externo gratuito para tocar o endereço abaixo na frequência desejada:
        </p>
        <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, padding: '16px 18px', margin: '18px 0', fontFamily: 'monospace', fontSize: '0.8rem', color: '#fbbf24', wordBreak: 'break-all' }}>
          {CRON_SETUP_DOC.endpoint}
        </div>
        <ol style={{ fontSize: '0.85rem', color: '#d4d4d4', lineHeight: 1.9, paddingLeft: 20 }}>
          {CRON_SETUP_DOC.passos.map((p, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: p }} />
          ))}
        </ol>
        <p style={{ fontSize: '0.78rem', color: '#737373', marginTop: 18, lineHeight: 1.6 }}>
          Serviços gratuitos que funcionam: cron-job.org, EasyCron, GitHub Actions (schedule) ou Vercel Cron
          (com o segredo configurado como variável de ambiente no projeto). Sempre chame de hora em hora —
          o sistema decide sozinho se já é hora de gerar a cópia conforme a frequência escolhida no painel.
        </p>
        <a href="/admin" style={{ color: '#FF9200', fontSize: '0.85rem', fontWeight: 600 }}>← Voltar ao painel</a>
      </div>
    </main>
  );
}
