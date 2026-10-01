'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Painel de backup dos alunos (aba Contas de Acesso, visível a Owner/Admin Geral).
 * - Mostra a última cópia automática e o histórico mantido no servidor.
 * - Permite gerar um backup imediato e restaurar o mais recente com confirmação.
 * - A importação manual de CSV continua existindo na aba Alunos.
 */

type BackupIndexItem = {
  filename: string;
  created_at: string;
  total_alunos: number;
  size_bytes: number;
  por: string;
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtData(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

export default function BackupPanel({ onImported }: { onImported?: () => void }) {
  const [latest, setLatest] = useState<BackupIndexItem | null>(null);
  const [history, setHistory] = useState<BackupIndexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/backup-alunos', { cache: 'no-store' });
      const d = await res.json();
      if (res.ok && d.ok) {
        setLatest(d.latest ?? null);
        setHistory(Array.isArray(d.history) ? d.history : []);
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Não foi possível carregar o status do backup.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão ao carregar o status do backup.' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const gerar = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/backup-alunos', { method: 'POST' });
      const d = await res.json();
      if (res.ok && d.ok) {
        setMsg({ tipo: 'ok', texto: `Backup gerado com ${d.item.total_alunos} alunos e salvo no servidor.` });
        await carregar();
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Falha ao gerar o backup.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão ao gerar o backup.' });
    }
    setBusy(false);
  };

  const restaurar = async () => {
    if (!latest) return;
    const alvo = `alunos-${latest.filename.split('/').pop()}`;
    const txt = window.prompt(
      `Restaurar os dados do backup mais recente?\n\n` +
      `Cópia: ${alvo}\nGerado em: ${fmtData(latest.created_at)}\nAlunos: ${latest.total_alunos}\n\n` +
      `Digite RESTAURAR para confirmar. Somente campos preenchidos no CSV serão aplicados (nada é apagado).`
    );
    if (!txt) return;
    if (txt.trim().toUpperCase() !== 'RESTAURAR') {
      setMsg({ tipo: 'erro', texto: 'Confirmação inválida — nada foi alterado.' });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/admin/backup-alunos', { method: 'PUT' });
      const d = await res.json();
      if (res.ok && d.ok) {
        const r = d.result;
        setMsg({ tipo: 'ok', texto: `Restauração concluída: ${r.updated} alunos atualizados, ${r.notFound} não encontrados, ${r.skipped} sem alteração.` });
        onImported?.();
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Falha na restauração.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão na restauração.' });
    }
    setBusy(false);
  };

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF9200' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
            <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
          </svg>
        </div>
        <div>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Backup dos Alunos</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Cópia de segurança automática a cada inscrição, edição ou exclusão — com histórico de 30 cópias no servidor.
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '14px 0' }}>Carregando status do backup...</div>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '14px 0' }}>
            <div style={{ flex: '1 1 200px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Última cópia</div>
              {latest ? (
                <>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{fmtData(latest.created_at)}</div>
                  <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                    {latest.total_alunos} alunos · {fmtBytes(latest.size_bytes)} · por {latest.por}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: '0.85rem', color: '#b45309', fontWeight: 600 }}>Nenhuma cópia ainda — gere a primeira.</div>
              )}
            </div>
            <div style={{ flex: '1 1 200px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
              <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Histórico</div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{history.length} cópia(s)</div>
              <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: 2 }}>Retenção automática das 30 mais recentes</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={gerar} disabled={busy}
              style={{ background: 'linear-gradient(135deg,#FFA733,#FF9200)', color: '#0a0a0a', border: 'none', borderRadius: 9, padding: '9px 16px', fontWeight: 800, fontSize: '0.82rem', cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.7 : 1 }}>
              {busy ? 'Processando...' : 'Gerar backup agora'}
            </button>
            <a href="/api/admin/export-alunos" download
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 9, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', textDecoration: 'none' }}>
              Baixar CSV atual
            </a>
            <button onClick={restaurar} disabled={busy || !latest}
              style={{ background: 'var(--bg-input)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 9, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', cursor: busy || !latest ? 'not-allowed' : 'pointer', opacity: busy || !latest ? 0.5 : 1 }}>
              Restaurar última cópia
            </button>
          </div>

          {msg && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.5,
              background: msg.tipo === 'ok' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
              border: `1px solid ${msg.tipo === 'ok' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
              color: msg.tipo === 'ok' ? '#86efac' : '#fca5a5',
            }}>{msg.texto}</div>
          )}

          {history.length > 1 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Ver histórico completo ({history.length})
              </summary>
              <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10 }}>
                {history.map(h => (
                  <div key={h.filename} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--text-primary)' }}>{fmtData(h.created_at)}</span>
                    <span>{h.total_alunos} alunos · {fmtBytes(h.size_bytes)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
