'use client';

/**
 * ResponsaveisContasPanel — aba "Responsáveis" do painel: gestão das CONTAS de
 * responsável (students.conta_tipo), similar à gestão de alunos.
 *
 * Dados: GET /api/admin/responsaveis (campo `contas`).
 * Ações: POST action=delete-account (excluir acesso) e action=remover-funcao
 * (transformar em conta comum). Sessão do painel validada no servidor.
 */

import { useCallback, useEffect, useState } from 'react';
import { IconUser, IconWarn, IconCheck, IconX } from '@/components/icons';

type ContaResp = {
  student_id: string;
  nome: string;
  nucleo: string | null;
  foto_url: string | null;
  conta_tipo: string | null;
  tem_matricula: boolean;
  matricula: string | null;
  tem_acesso: boolean;
  eh_perfil_responsavel: boolean;
  dependentes: { id: string; nome: string; status: string }[];
  criado_em: string;
};

const ghost: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
  color: '#e5e5e5', borderRadius: 9, padding: '6px 12px', fontSize: '0.76rem',
  fontWeight: 700, cursor: 'pointer',
};
const perigo: React.CSSProperties = {
  border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)',
  color: '#f87171', borderRadius: 9, padding: '6px 12px', fontSize: '0.76rem',
  fontWeight: 700, cursor: 'pointer',
};
const ambar: React.CSSProperties = {
  border: 'none', background: 'linear-gradient(135deg, #ffb84d 0%, #FF9200 55%, #f07f00 100%)',
  color: '#141414', borderRadius: 9, padding: '6px 13px', fontSize: '0.76rem',
  fontWeight: 800, cursor: 'pointer', boxShadow: '0 3px 12px rgba(255,146,0,0.28)',
};

export default function ResponsaveisContasPanel() {
  const [contas, setContas] = useState<ContaResp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/responsaveis', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        setContas(Array.isArray(d.contas) ? d.contas : []);
      } else {
        setMsg({ t: 'Não foi possível carregar as contas de responsável.', ok: false });
      }
    } catch {
      setMsg({ t: 'Falha de conexão.', ok: false });
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const acao = async (payload: Record<string, unknown>, okMsg: string) => {
    setMsg(null);
    const res = await fetch('/api/admin/responsaveis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg({ t: d.error || 'Erro na operação.', ok: false }); return false; }
    setMsg({ t: okMsg, ok: true });
    await carregar();
    return true;
  };

  const filtradas = contas.filter(c => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return (
      c.nome.toLowerCase().includes(q) ||
      (c.nucleo || '').toLowerCase().includes(q) ||
      (c.matricula || '').includes(q) ||
      c.dependentes.some(d => d.nome.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ display: 'flex', color: '#FF9200' }}><IconUser size={19} /></span>
          <div>
            <h3 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-primary)' }}>Contas de Responsáveis</h3>
            <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              Contas criadas como responsável (só responsável ou responsável + aluno), dependentes vinculados e acesso ao app
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, núcleo, matrícula…"
            aria-label="Buscar conta de responsável"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 12px', fontSize: '0.8rem', color: 'var(--text-primary)', minWidth: 200 }}
          />
          <button onClick={carregar} style={ambar}>Atualizar</button>
        </div>
      </div>

      {msg && (
        <div style={{
          marginBottom: 12, padding: '9px 13px', borderRadius: 10, fontSize: '0.8rem',
          background: msg.ok ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
          border: `1px solid ${msg.ok ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: msg.ok ? '#86efac' : '#fca5a5',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ display: 'flex' }}>{msg.ok ? <IconCheck size={15} /> : <IconWarn size={15} />}</span>
          <span style={{ flex: 1 }}>{msg.t}</span>
          <button onClick={() => setMsg(null)} aria-label="Dispensar" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 2 }}><IconX size={13} /></button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 20, fontSize: '0.85rem' }}>Carregando…</div>
      ) : filtradas.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '24px 12px', fontSize: '0.84rem', lineHeight: 1.6 }}>
          {contas.length === 0
            ? 'Nenhuma conta de responsável criada ainda. Contas criadas no app como “sou responsável” aparecem aqui.'
            : 'Nenhuma conta encontrada para a busca.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtradas.map(c => (
            <div key={c.student_id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,146,0,0.12)', color: '#FF9200', flexShrink: 0, overflow: 'hidden' }}>
                  {c.foto_url
                    ? // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <IconUser size={18} />}
                </span>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)' }}>{c.nome}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                    {c.nucleo || 'sem núcleo'}
                    {c.tem_matricula && c.matricula ? ` · matrícula CCLN-${c.matricula}` : ''}
                    {` · desde ${new Date(c.criado_em).toLocaleDateString('pt-BR')}`}
                  </div>
                </div>
                <span style={{ fontSize: '0.66rem', fontWeight: 800, padding: '3px 9px', borderRadius: 999, background: 'rgba(255,146,0,0.10)', color: '#FF9200', border: '1px solid rgba(255,146,0,0.3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {c.conta_tipo === 'responsavel_aluno' ? 'Responsável + aluno' : 'Só responsável'}
                </span>
                <span style={{
                  fontSize: '0.66rem', fontWeight: 800, padding: '3px 9px', borderRadius: 999,
                  background: c.tem_acesso ? 'rgba(34,197,94,0.12)' : 'rgba(148,163,184,0.12)',
                  color: c.tem_acesso ? '#4ade80' : '#94a3b8',
                  border: `1px solid ${c.tem_acesso ? 'rgba(34,197,94,0.3)' : 'rgba(148,163,184,0.3)'}`,
                }}>
                  {c.tem_acesso ? 'Com acesso' : 'Sem acesso'}
                </span>
              </div>

              {c.dependentes.length > 0 && (
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <strong style={{ color: 'var(--text-primary)', fontSize: '0.74rem' }}>Dependentes:</strong>
                  {c.dependentes.map(d => (
                    <span key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 999, padding: '2px 9px' }}>
                      {d.nome}
                      <span style={{ fontSize: '0.62rem', fontWeight: 800, color: d.status === 'active' ? '#4ade80' : '#facc15', textTransform: 'uppercase' }}>
                        {d.status === 'active' ? 'ativo' : d.status === 'pending' ? 'pendente' : d.status === 'revoked' ? 'revogado' : 'recusado'}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  disabled={ocupado === c.student_id || !c.tem_acesso}
                  onClick={async () => {
                    if (!window.confirm(`Excluir o ACESSO (login/senha) de ${c.nome}? O cadastro e o histórico permanecem.`)) return;
                    setOcupado(c.student_id);
                    await acao({ action: 'delete-account', student_id: c.student_id }, 'Acesso excluído.');
                    setOcupado(null);
                  }}
                  style={{ ...perigo, opacity: ocupado === c.student_id || !c.tem_acesso ? 0.45 : 1, cursor: !c.tem_acesso ? 'not-allowed' : 'pointer' }}
                  title={c.tem_acesso ? 'Excluir login/senha desta conta' : 'Esta conta não tem acesso próprio'}
                >
                  Excluir acesso
                </button>
                <button
                  disabled={ocupado === c.student_id}
                  onClick={async () => {
                    if (!window.confirm(`Remover a função de responsável de ${c.nome}? A conta volta a ser tratada como comum (o cadastro e os vínculos registrados permanecem).`)) return;
                    setOcupado(c.student_id);
                    await acao({ action: 'remover-funcao', student_id: c.student_id }, 'Função de responsável removida.');
                    setOcupado(null);
                  }}
                  style={{ ...ghost, opacity: ocupado === c.student_id ? 0.45 : 1 }}
                >
                  Remover função
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
