'use client';

/**
 * ResponsaveisContasPanel — aba "Responsáveis" do painel: gestão completa das
 * CONTAS de responsável (students.conta_tipo), similar à gestão de alunos.
 *
 * Dados: GET /api/admin/responsaveis (campo `contas`).
 * Ações (POST /api/admin/responsaveis): editar-dados · delete-account ·
 *   remover-funcao · link-create.
 * Acesso (POST /api/aluno/auth, exige sessão do painel): admin-create-auto ·
 *   admin-edit-account · admin-reset-password.
 * Edição de cadastro completo do dependente: PATCH /api/aluno/dados (painel).
 * Sessão do painel validada no servidor em todas as rotas.
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
  acesso_username: string | null;
  acesso_email: string | null;
  telefone: string | null;
  email: string | null;
  eh_perfil_responsavel: boolean;
  dependentes: { id: string; nome: string; status: string }[];
  criado_em: string;
};

type DadosCompletos = {
  nome_completo?: string | null;
  telefone?: string | null;
  email?: string | null;
  cep?: string | null;
  endereco?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
};

type AlunoOpcao = { id: string; nome: string; matricula: string | null; nucleo: string | null };

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
const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 11px',
  background: 'var(--bg-input)', border: '1.5px solid var(--border)',
  borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.84rem', outline: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.7rem', fontWeight: 700,
  color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
};

function Modal({ titulo, subtitulo, onClose, children }: {
  titulo: string; subtitulo?: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog" aria-modal="true" aria-label={titulo}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 320, padding: 16 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', border: '1px solid var(--border)', boxShadow: '0 8px 40px rgba(0,0,0,0.35)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontWeight: 800, fontSize: '0.98rem', color: 'var(--text-primary)' }}>{titulo}</h3>
            {subtitulo && <p style={{ margin: '2px 0 0', fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{subtitulo}</p>}
          </div>
          <button onClick={onClose} aria-label="Fechar" style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }}><IconX size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ResponsaveisContasPanel() {
  const [contas, setContas] = useState<ContaResp[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [msg, setMsg] = useState<{ t: string; ok: boolean } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Modais
  const [editDados, setEditDados] = useState<{ conta: ContaResp; form: DadosCompletos } | null>(null);
  const [editSalvando, setEditSalvando] = useState(false);
  const [acessoModal, setAcessoModal] = useState<{ conta: ContaResp; modo: 'criar' | 'editar' | 'senha'; usuario: string; email: string; telefone: string; senha: string; senha2: string } | null>(null);
  const [acessoSalvando, setAcessoSalvando] = useState(false);
  const [vincModal, setVincModal] = useState<{ conta: ContaResp; alunos: AlunoOpcao[]; carregando: boolean; busca: string; selecionado: AlunoOpcao | null; relacao: string } | null>(null);
  const [vincSalvando, setVincSalvando] = useState(false);

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

  const acao = async (payload: Record<string, unknown>, okMsg: string, url = '/api/admin/responsaveis') => {
    setMsg(null);
    const res = await fetch(url, {
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

  const abrirEditarDados = async (c: ContaResp) => {
    setMsg(null);
    setEditDados({ conta: c, form: { nome_completo: c.nome, telefone: c.telefone || '', email: c.email || '' } });
    try {
      const res = await fetch(`/api/aluno/dados?student_id=${c.student_id}`, { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        const s = (d.student || d) as Record<string, string | null>;
        setEditDados({
          conta: c,
          form: {
            nome_completo: s.nome_completo || c.nome,
            telefone: s.telefone || c.telefone || '',
            email: s.email || c.email || '',
            cep: s.cep || '', endereco: s.endereco || '', numero: s.numero || '',
            complemento: s.complemento || '', bairro: s.bairro || '',
            cidade: s.cidade || '', estado: s.estado || '',
          },
        });
      }
    } catch { /* mantém o que já temos */ }
  };

  const salvarDados = async () => {
    if (!editDados) return;
    setEditSalvando(true);
    const f = editDados.form;
    const ok = await acao({
      action: 'editar-dados',
      student_id: editDados.conta.student_id,
      nome: f.nome_completo, telefone: f.telefone, email: f.email,
      cep: f.cep, endereco: f.endereco, numero: f.numero,
      complemento: f.complemento, bairro: f.bairro, cidade: f.cidade, estado: f.estado,
    }, 'Dados atualizados.');
    setEditSalvando(false);
    if (ok) setEditDados(null);
  };

  const abrirAcesso = (c: ContaResp, modo: 'criar' | 'editar' | 'senha') => {
    setMsg(null);
    setAcessoModal({
      conta: c, modo,
      usuario: c.acesso_username || '',
      email: c.acesso_email || c.email || '',
      telefone: c.telefone || '',
      senha: '', senha2: '',
    });
  };

  const salvarAcesso = async () => {
    if (!acessoModal) return;
    const { conta, modo, usuario, email, telefone, senha } = acessoModal;
    if (senha && senha !== acessoModal.senha2) { setMsg({ t: 'As senhas não coincidem.', ok: false }); return; }
    if (senha && senha.length < 6) { setMsg({ t: 'A senha deve ter pelo menos 6 caracteres.', ok: false }); return; }
    setAcessoSalvando(true);
    let ok = false;
    if (modo === 'criar') {
      if (senha.length < 6) { setMsg({ t: 'Defina uma senha de pelo menos 6 caracteres.', ok: false }); setAcessoSalvando(false); return; }
      ok = await acao({ action: 'admin-create-auto', student_id: conta.student_id, password: senha, email }, 'Acesso criado — usuário e senha definidos.', '/api/aluno/auth');
    } else if (modo === 'senha') {
      ok = await acao({ action: 'admin-reset-password', student_id: conta.student_id, new_password: senha, notify_email: email, student_name: conta.nome }, 'Senha redefinida.', '/api/aluno/auth');
    } else {
      ok = await acao({
        action: 'admin-edit-account', student_id: conta.student_id,
        new_username: usuario || undefined, new_email: email, new_phone: telefone,
        new_password: senha || undefined,
      }, 'Acesso atualizado.', '/api/aluno/auth');
    }
    setAcessoSalvando(false);
    if (ok) setAcessoModal(null);
  };

  const abrirVinculo = async (c: ContaResp) => {
    setMsg(null);
    setVincModal({ conta: c, alunos: [], carregando: true, busca: '', selecionado: null, relacao: 'responsavel_legal' });
    try {
      const [resAlunos, resIds] = await Promise.all([
        fetch('/api/presenca/students', { cache: 'no-store' }),
        fetch('/api/aluno/gerar-id', { cache: 'no-store' }),
      ]);
      const lista = resAlunos.ok ? await resAlunos.json() : [];
      const ids = resIds.ok ? await resIds.json() : {};
      const alunos: AlunoOpcao[] = (Array.isArray(lista) ? lista : [])
        .filter((a: { conta_tipo?: string | null }) => a.conta_tipo !== 'responsavel')
        .map((a: { id: string; nome_completo: string; nucleo?: string | null }) => ({
          id: a.id,
          nome: a.nome_completo,
          matricula: (ids as Record<string, string>)[a.id] || null,
          nucleo: a.nucleo || null,
        }));
      setVincModal(v => v ? { ...v, alunos, carregando: false } : v);
    } catch {
      setVincModal(v => v ? { ...v, carregando: false } : v);
    }
  };

  const salvarVinculo = async () => {
    if (!vincModal?.selecionado) return;
    setVincSalvando(true);
    const ok = await acao({
      action: 'link-create',
      guardian_student_id: vincModal.conta.student_id,
      student_id: vincModal.selecionado.id,
      relacao: vincModal.relacao,
    }, `Vínculo criado com ${vincModal.selecionado.nome}.`);
    setVincSalvando(false);
    if (ok) setVincModal(null);
  };

  const filtradas = contas.filter(c => {
    const q = busca.trim().toLowerCase();
    if (!q) return true;
    return (
      c.nome.toLowerCase().includes(q) ||
      (c.nucleo || '').toLowerCase().includes(q) ||
      (c.matricula || '').includes(q) ||
      (c.acesso_username || '').toLowerCase().includes(q) ||
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
              Cadastro, dependentes, acesso ao app e vínculos — gestão completa
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar por nome, núcleo, usuário…"
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
                  {(c.acesso_username || c.telefone || c.email) && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {c.acesso_username ? `👤 ${c.acesso_username}` : ''}
                      {c.telefone ? `${c.acesso_username ? ' · ' : ''}📞 ${c.telefone}` : ''}
                      {c.email ? `${c.acesso_username || c.telefone ? ' · ' : ''}✉️ ${c.email}` : ''}
                    </div>
                  )}
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
                <button disabled={ocupado === c.student_id} onClick={() => abrirEditarDados(c)} style={ghost}>✏️ Editar dados</button>
                <button disabled={ocupado === c.student_id} onClick={() => abrirVinculo(c)} style={ghost}>👨‍👩‍👧 Vincular dependente</button>
                {c.tem_acesso ? (
                  <>
                    <button disabled={ocupado === c.student_id} onClick={() => abrirAcesso(c, 'editar')} style={ghost}>🔑 Editar acesso</button>
                    <button disabled={ocupado === c.student_id} onClick={() => abrirAcesso(c, 'senha')} style={ghost}>🔒 Resetar senha</button>
                  </>
                ) : (
                  <button disabled={ocupado === c.student_id} onClick={() => abrirAcesso(c, 'criar')} style={ambar}>➕ Criar acesso</button>
                )}
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

      {/* ── Modal: editar dados pessoais ── */}
      {editDados && (
        <Modal titulo={`Editar dados — ${editDados.conta.nome}`} subtitulo="Cadastro pessoal da conta de responsável" onClose={() => setEditDados(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Nome completo *</label>
              <input value={editDados.form.nome_completo || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, nome_completo: e.target.value } })} style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>Telefone</label>
                <input value={editDados.form.telefone || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, telefone: e.target.value } })} placeholder="(21) 90000-0000" inputMode="tel" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>E-mail</label>
                <input value={editDados.form.email || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, email: e.target.value } })} type="email" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>CEP</label>
                <input value={editDados.form.cep || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, cep: e.target.value } })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Endereço</label>
                <input value={editDados.form.endereco || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, endereco: e.target.value } })} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>Número</label>
                <input value={editDados.form.numero || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, numero: e.target.value } })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Complemento</label>
                <input value={editDados.form.complemento || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, complemento: e.target.value } })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Bairro</label>
                <input value={editDados.form.bairro || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, bairro: e.target.value } })} style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
              <div>
                <label style={labelStyle}>Cidade</label>
                <input value={editDados.form.cidade || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, cidade: e.target.value } })} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Estado</label>
                <input value={editDados.form.estado || ''} onChange={e => setEditDados({ ...editDados, form: { ...editDados.form, estado: e.target.value } })} maxLength={2} placeholder="RJ" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setEditDados(null)} style={ghost}>Cancelar</button>
              <button disabled={editSalvando || !(editDados.form.nome_completo || '').trim()} onClick={salvarDados} style={ambar}>
                {editSalvando ? '⏳ Salvando…' : '💾 Salvar dados'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal: acesso (criar / editar / senha) ── */}
      {acessoModal && (
        <Modal
          titulo={acessoModal.modo === 'criar' ? `Criar acesso — ${acessoModal.conta.nome}` : acessoModal.modo === 'senha' ? `Resetar senha — ${acessoModal.conta.nome}` : `Editar acesso — ${acessoModal.conta.nome}`}
          subtitulo={acessoModal.modo === 'criar'
            ? 'Cria login e senha para esta conta entrar no app (matrícula automática quando for o caso)'
            : acessoModal.modo === 'senha'
              ? 'Define uma nova senha; o e-mail informado recebe os dados, se houver serviço de e-mail configurado'
              : 'Usuário, e-mail, telefone e senha da conta'}
          onClose={() => setAcessoModal(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {acessoModal.modo !== 'senha' && (
              <>
                <div>
                  <label style={labelStyle}>Usuário de acesso</label>
                  <input value={acessoModal.usuario} onChange={e => setAcessoModal({ ...acessoModal, usuario: e.target.value.toLowerCase().replace(/\s+/g, '') })} placeholder="ex: maria215" style={inputStyle} />
                  {acessoModal.modo === 'criar' && (
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', marginTop: 3 }}>Deixe em branco para gerar automaticamente (nome + matrícula).</div>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>E-mail</label>
                    <input value={acessoModal.email} onChange={e => setAcessoModal({ ...acessoModal, email: e.target.value })} type="email" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Telefone</label>
                    <input value={acessoModal.telefone} onChange={e => setAcessoModal({ ...acessoModal, telefone: e.target.value })} inputMode="tel" style={inputStyle} />
                  </div>
                </div>
              </>
            )}
            <div>
              <label style={labelStyle}>{acessoModal.modo === 'senha' ? 'Nova senha *' : 'Senha'}</label>
              <input value={acessoModal.senha} onChange={e => setAcessoModal({ ...acessoModal, senha: e.target.value })} type="password" placeholder="Mín. 6 caracteres" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Repetir senha</label>
              <input value={acessoModal.senha2} onChange={e => setAcessoModal({ ...acessoModal, senha2: e.target.value })} type="password" style={{ ...inputStyle, borderColor: acessoModal.senha && acessoModal.senha2 && acessoModal.senha !== acessoModal.senha2 ? '#ef4444' : 'var(--border)' }} />
              {acessoModal.senha && acessoModal.senha2 && acessoModal.senha !== acessoModal.senha2 && (
                <div style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: 3 }}>As senhas não coincidem.</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setAcessoModal(null)} style={ghost}>Cancelar</button>
              <button
                disabled={acessoSalvando || !acessoModal.senha || acessoModal.senha !== acessoModal.senha2 || acessoModal.senha.length < 6}
                onClick={salvarAcesso}
                style={ambar}
              >
                {acessoSalvando ? '⏳ Salvando…' : acessoModal.modo === 'criar' ? '➕ Criar acesso' : acessoModal.modo === 'senha' ? '🔒 Redefinir senha' : '💾 Salvar acesso'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal: vincular dependente existente ── */}
      {vincModal && (
        <Modal
          titulo={`Vincular dependente — ${vincModal.conta.nome}`}
          subtitulo="Escolha um aluno já cadastrado para vincular como dependente desta conta"
          onClose={() => setVincModal(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              value={vincModal.busca}
              onChange={e => setVincModal({ ...vincModal, busca: e.target.value })}
              placeholder="Buscar aluno por nome ou matrícula…"
              aria-label="Buscar aluno para vincular"
              style={inputStyle}
            />
            <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {vincModal.carregando ? (
                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 16, fontSize: '0.82rem' }}>Carregando alunos…</div>
              ) : (() => {
                const q = vincModal.busca.trim().toLowerCase();
                const opcoes = vincModal.alunos.filter(a =>
                  !q || a.nome.toLowerCase().includes(q) || (a.matricula || '').toLowerCase().includes(q),
                );
                if (opcoes.length === 0) return <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: 16, fontSize: '0.82rem' }}>Nenhum aluno encontrado.</div>;
                return opcoes.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setVincModal({ ...vincModal, selecionado: a })}
                    style={{
                      textAlign: 'left', padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
                      border: `1.5px solid ${vincModal.selecionado?.id === a.id ? '#FF9200' : 'var(--border)'}`,
                      background: vincModal.selecionado?.id === a.id ? 'rgba(255,146,0,0.10)' : 'rgba(255,255,255,0.03)',
                      color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600,
                      display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center',
                    }}
                  >
                    <span>{a.nome}</span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                      {a.matricula || a.nucleo || ''}
                    </span>
                  </button>
                ));
              })()}
            </div>
            {vincModal.selecionado && (
              <div>
                <label style={labelStyle}>Relação</label>
                <select value={vincModal.relacao} onChange={e => setVincModal({ ...vincModal, relacao: e.target.value })} style={inputStyle}>
                  <option value="responsavel_legal">Responsável legal</option>
                  <option value="mae">Mãe</option>
                  <option value="pai">Pai</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setVincModal(null)} style={ghost}>Cancelar</button>
              <button disabled={vincSalvando || !vincModal.selecionado} onClick={salvarVinculo} style={ambar}>
                {vincSalvando ? '⏳ Vinculando…' : '🔗 Criar vínculo'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
