'use client';

/**
 * ResponsaveisPanel — gestão de responsáveis, vínculos e autorizações de
 * adolescentes dentro da aba Contas Alunos do painel. Todos os comandos
 * passam por /api/admin/responsaveis (sessão validada no servidor, com
 * filtro de núcleo para admin de núcleo).
 */

import { useCallback, useEffect, useState } from 'react';
import { IconUser, IconWarn, IconCheck, IconX, IconDoc } from '@/components/icons';

type Perfil = { student_id: string; nome: string; nucleo: string | null; cpf_mascarado: string; criado_em: string; conta_tipo?: string | null };
type Vinculo = {
  id: string; guardian_student_id: string; guardian_nome: string;
  student_id: string; student_nome: string; student_nucleo: string | null;
  relacao: string; status: string; criado_em: string;
};
type Autorizacao = {
  student_id: string; student_nome: string; student_nucleo: string | null;
  status: string; resp_nome: string; resp_relacao: string; resp_email_mascarado: string;
  termo_versao: string; assinado_em: string | null; doc_hash: string | null; tem_documento: boolean;
};

const STATUS_LABEL: Record<string, { l: string; cor: string; fundo: string }> = {
  active: { l: 'Ativo', cor: '#4ade80', fundo: 'rgba(34,197,94,0.12)' },
  pending: { l: 'Pendente', cor: '#facc15', fundo: 'rgba(234,179,8,0.12)' },
  rejected: { l: 'Recusado', cor: '#f87171', fundo: 'rgba(239,68,68,0.12)' },
  revoked: { l: 'Revogado', cor: '#f87171', fundo: 'rgba(239,68,68,0.12)' },
  authorized: { l: 'Autorizado', cor: '#4ade80', fundo: 'rgba(34,197,94,0.12)' },
};

const ghost: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
  color: '#e5e5e5', borderRadius: 9, padding: '6px 12px', fontSize: '0.76rem',
  fontWeight: 700, cursor: 'pointer',
};
const ambar: React.CSSProperties = {
  border: 'none', background: 'linear-gradient(135deg, #ffb84d 0%, #FF9200 55%, #f07f00 100%)',
  color: '#141414', borderRadius: 9, padding: '6px 13px', fontSize: '0.76rem',
  fontWeight: 800, cursor: 'pointer', boxShadow: '0 3px 12px rgba(255,146,0,0.28)',
};
const perigo: React.CSSProperties = {
  border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)',
  color: '#f87171', borderRadius: 9, padding: '6px 12px', fontSize: '0.76rem',
  fontWeight: 700, cursor: 'pointer',
};

export default function ResponsaveisPanel() {
  const [perfis, setPerfis] = useState<Perfil[]>([]);
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [autorizacoes, setAutorizacoes] = useState<Autorizacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/responsaveis', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        setPerfis(d.perfis || []);
        setVinculos(d.vinculos || []);
        setAutorizacoes(d.autorizacoes || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const acao = async (payload: Record<string, unknown>) => {
    setMsg(null);
    const res = await fetch('/api/admin/responsaveis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg({ t: d.error || 'Erro na operação.', ok: false }); return false; }
    setMsg({ t: 'Operação concluída.', ok: true });
    await carregar();
    return true;
  };

  const abrirDocumento = async (studentId: string) => {
    try {
      const res = await fetch(`/api/aluno/autorizacao?student_id=${studentId}&doc=1`);
      const d = await res.json();
      if (res.ok && d.url) window.open(d.url, '_blank', 'noopener');
      else setMsg({ t: d.error || 'Documento não disponível.', ok: false });
    } catch {
      setMsg({ t: 'Falha ao abrir documento.', ok: false });
    }
  };

  const pendentes = vinculos.filter(v => v.status === 'pending');

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ display: 'flex', color: '#FF9200' }}><IconUser size={19} /></span>
          <div>
            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>Responsáveis & Autorizações</h3>
            <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              Perfis de responsável, vínculos com tutelados e termos de autorização de adolescentes (15–17)
            </p>
          </div>
        </div>
        <button onClick={carregar} style={ambar}>Atualizar</button>
      </div>

      {msg && (
        <div style={{
          marginBottom: 12, padding: '9px 13px', borderRadius: 10, fontSize: '0.8rem',
          background: msg.ok ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
          border: `1px solid ${msg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: msg.ok ? '#86efac' : '#fca5a5',
        }}>{msg.t}</div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20, fontSize: '0.85rem' }}>Carregando…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Solicitações pendentes */}
          {pendentes.length > 0 && (
            <div style={{ border: '1px solid rgba(234,179,8,0.35)', background: 'rgba(234,179,8,0.06)', borderRadius: 12, padding: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '0.86rem', color: '#facc15', marginBottom: 9 }}>
                <IconWarn size={16} /> {pendentes.length} solicitação{pendentes.length > 1 ? 'es' : ''} de vínculo aguardando decisão
              </div>
              {pendentes.map(v => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '7px 0', borderTop: '1px solid rgba(234,179,8,0.15)' }}>
                  <div style={{ flex: 1, minWidth: 200, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                    <strong>{v.guardian_nome}</strong> → {v.student_nome}
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}> · {v.student_nucleo || 'sem núcleo'} · {v.relacao}</span>
                  </div>
                  <button onClick={() => acao({ action: 'link-approve', link_id: v.id })} style={ambar}>Aprovar</button>
                  <button onClick={() => acao({ action: 'link-reject', link_id: v.id })} style={perigo}>Recusar</button>
                </div>
              ))}
            </div>
          )}

          {/* Autorizações de adolescente */}
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Autorizações de adolescentes ({autorizacoes.length})
            </div>
            {autorizacoes.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '8px 0' }}>Nenhuma autorização registrada.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {autorizacoes.map(a => {
                  const st = STATUS_LABEL[a.status] || STATUS_LABEL.pending;
                  return (
                    <div key={a.student_id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 11, padding: '9px 12px' }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>{a.student_nome}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                          Resp.: {a.resp_nome || '—'} · {a.resp_email_mascarado} · termo v{a.termo_versao}
                          {a.assinado_em ? ` · assinado ${new Date(a.assinado_em).toLocaleDateString('pt-BR')}` : ''}
                        </div>
                      </div>
                      <span style={{ fontSize: '0.68rem', fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: st.fundo, color: st.cor, textTransform: 'uppercase' }}>{st.l}</span>
                      {a.tem_documento && (
                        <button onClick={() => abrirDocumento(a.student_id)} title="Abrir termo assinado" style={ghost}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><IconDoc size={13} /> Termo</span>
                        </button>
                      )}
                      {a.status === 'authorized' && (
                        <button onClick={() => { if (window.confirm('Revogar a autorização? As ações do adolescente ficarão bloqueadas.')) acao({ action: 'authz-revoke', student_id: a.student_id }); }} style={perigo}>Revogar</button>
                      )}
                      {a.status === 'revoked' && (
                        <button onClick={() => acao({ action: 'authz-reactivate', student_id: a.student_id })} style={ghost}>Reativar</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vínculos */}
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Vínculos responsável ↔ aluno ({vinculos.length})
            </div>
            {vinculos.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '8px 0' }}>Nenhum vínculo registrado.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {vinculos.map(v => {
                  const st = STATUS_LABEL[v.status] || STATUS_LABEL.pending;
                  return (
                    <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 11, padding: '9px 12px' }}>
                      <div style={{ flex: 1, minWidth: 220, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                        <strong>{v.guardian_nome}</strong> <span style={{ color: 'var(--text-secondary)' }}>→</span> {v.student_nome}
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}> · {v.student_nucleo || 'sem núcleo'}</span>
                      </div>
                      <span style={{ fontSize: '0.68rem', fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: st.fundo, color: st.cor, textTransform: 'uppercase' }}>{st.l}</span>
                      {v.status === 'active' && (
                        <button onClick={() => { if (window.confirm('Revogar este vínculo?')) acao({ action: 'link-revoke', link_id: v.id }); }} style={perigo}>Revogar</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Perfis de responsável */}
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Perfis de responsável ({perfis.length})
            </div>
            {perfis.length === 0 ? (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '8px 0' }}>Nenhum perfil de responsável ativo.</div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                {perfis.map(p => (
                  <span key={p.student_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(255,146,0,0.08)', border: '1px solid rgba(255,146,0,0.28)', borderRadius: 999, padding: '5px 12px', fontSize: '0.78rem', color: '#f5f5f4' }}>
                    <IconCheck size={13} style={{ color: '#FF9200' }} />
                    {p.nome}{p.nucleo ? ` · ${p.nucleo}` : ''}{p.conta_tipo === 'responsavel' ? ' · só responsável' : p.conta_tipo === 'responsavel_aluno' ? ' · responsável + aluno' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
