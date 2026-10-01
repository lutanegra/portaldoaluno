'use client';

/**
 * PerfilGuardiaoCard — área "Responsáveis & Perfis" do app do aluno.
 *
 * Tudo que este componente mostra/faz passa pela API /api/aluno/auth
 * (account-status, become-guardian, link-code, link-guardian, link-decide,
 * link-revoke) e /api/aluno/autorizacao — o servidor valida vínculos,
 * faixas de idade e identidade. O frontend nunca decide permissão.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconUser, IconWarn, IconCheck, IconX, IconDoc } from '@/components/icons';

type Tutorado = {
  student_id: string;
  nome_completo: string;
  nucleo: string | null;
  graduacao: string | null;
  foto_url: string | null;
  idade: number | null;
  menor_de_idade: boolean;
  status_vinculo: string;
  relacao: string;
};

type AccountStatus = {
  student_id: string;
  idade: number | null;
  faixa: 'bloqueado' | 'precisa_autorizacao' | 'independente';
  eh_adulto: boolean;
  maior_de_idade: boolean;
  autorizacao_status: 'necessaria_pendente' | 'autorizado' | 'revogado' | 'desnecessaria';
  conta_liberada: boolean;
  acesso_ativo: boolean;
  pode_ser_responsavel: boolean;
  perfil_responsavel: { ativo: boolean; vinculos_ativos: number } | null;
  tutelados: Tutorado[];
  vinculos_pendentes_recebidos: { guardian_student_id: string; nome: string; relacao: string }[];
};

const RELACOES = [
  { v: 'responsavel_legal', l: 'Responsável legal' },
  { v: 'pai', l: 'Pai' },
  { v: 'mae', l: 'Mãe' },
  { v: 'pai_social', l: 'Pai social' },
  { v: 'mae_social', l: 'Mãe social' },
  { v: 'avo', l: 'Avô/Avó' },
  { v: 'outro', l: 'Outro' },
];

const btnBase: React.CSSProperties = {
  border: 'none',
  borderRadius: 11,
  padding: '10px 16px',
  fontWeight: 700,
  fontSize: '0.82rem',
  cursor: 'pointer',
  background: 'linear-gradient(135deg, #ffb84d 0%, #FF9200 55%, #f07f00 100%)',
  color: '#141414',
  boxShadow: '0 4px 16px rgba(255,146,0,0.30)',
};

const btnGhost: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 11,
  padding: '10px 16px',
  fontWeight: 700,
  fontSize: '0.82rem',
  cursor: 'pointer',
  background: 'rgba(255,255,255,0.05)',
  color: '#e5e5e5',
};

const cardStyle: React.CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,0.055), rgba(255,255,255,0.025))',
  border: '1px solid rgba(255,255,255,0.09)',
  borderRadius: 16,
  padding: '16px',
  color: '#f5f5f4',
};


export default function PerfilGuardiaoCard({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ texto: string; tipo: 'ok' | 'erro' } | null>(null);

  // virar responsável
  const [mostrarVirarResp, setMostrarVirarResp] = useState(false);
  const [cpfResp, setCpfResp] = useState('');
  const [virarLoading, setVirarLoading] = useState(false);

  // adicionar tutelado
  const [mostrarAdd, setMostrarAdd] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [matricula, setMatricula] = useState('');
  const [relacao, setRelacao] = useState('responsavel_legal');
  const [addLoading, setAddLoading] = useState(false);

  // cadastrar criança do zero (sem conta)
  const [mostrarNovo, setMostrarNovo] = useState(false);
  const [novoForm, setNovoForm] = useState({ nome_completo: '', data_nascimento: '', cpf: '', nucleo: '', relacao: 'responsavel_legal' });
  const [nucleosLista, setNucleosLista] = useState<{ id: string; nome: string }[]>([]);
  const [novoLoading, setNovoLoading] = useState(false);
  const [novoResultado, setNovoResultado] = useState<string>('');

  // autorização de adolescente (15–17)
  const [authzEtapa, setAuthzEtapa] = useState<'dados' | 'codigo' | 'termo' | 'concluido' | null>(null);
  const [authzForm, setAuthzForm] = useState({ resp_nome: '', resp_cpf: '', resp_nascimento: '', resp_relacao: 'responsavel_legal', resp_email: '', resp_telefone: '' });
  const [authzCodigo, setAuthzCodigo] = useState('');
  const [authzTermo, setAuthzTermo] = useState<{ titulo: string; corpo: string[] } | null>(null);
  const [aceite, setAceite] = useState(false);
  const [assinaturaTrajeto, setAssinaturaTrajeto] = useState<string[]>([]);
  const [assinando, setAssinando] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhandoRef = useRef(false);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/aluno/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'account-status' }),
      });
      if (res.ok) setStatus(await res.json());
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Núcleos disponíveis para o cadastro do tutelado
  useEffect(() => {
    fetch('/api/admin/nucleos', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : []))
      .then((d: { id?: string; nome?: string }[]) => {
        setNucleosLista((Array.isArray(d) ? d : []).map(n => ({ id: String(n.id || ''), nome: String(n.nome || '') })).filter(n => n.id && n.nome));
      })
      .catch(() => {});
  }, []);

  const acao = async (payload: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown> }> => {
    try {
      const res = await fetch('/api/aluno/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, data };
      return { ok: true, data };
    } catch {
      return { ok: false };
    }
  };

  /* ── Autorização de adolescente ─────────────────────────────────────────── */

  const carregarAuthz = useCallback(async () => {
    try {
      const res = await fetch('/api/aluno/autorizacao', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (d.necessario) {
        if (d.status === 'authorized') setAuthzEtapa('concluido');
        else if (d.etapa === 'termo') setAuthzEtapa('termo');
        else if (d.etapa === 'codigo') setAuthzEtapa('codigo');
        else setAuthzEtapa('dados');
      }
    } catch {}
  }, []);

  useEffect(() => {
    const s = status;
    if (s && s.autorizacao_status === 'necessaria_pendente') carregarAuthz();
    if (s && s.autorizacao_status === 'autorizado') setAuthzEtapa('concluido');
    if (s && s.autorizacao_status === 'revogado') setAuthzEtapa(null);
  }, [status, carregarAuthz]);

  const enviarDadosResponsavel = async () => {
    setMsg(null);
    setVirarLoading(true);
    try {
      const res = await fetch('/api/aluno/autorizacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', ...authzForm }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ texto: d.error || 'Erro ao iniciar.', tipo: 'erro' }); return; }
      setMsg({ texto: d.message || 'Código enviado.', tipo: 'ok' });
      setAuthzEtapa('codigo');
    } finally {
      setVirarLoading(false);
    }
  };

  const reenviarCodigo = async () => {
    setMsg(null);
    const res = await fetch('/api/aluno/autorizacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resend' }),
    });
    const d = await res.json().catch(() => ({}));
    setMsg({ texto: d.message || (res.ok ? 'Código reenviado.' : 'Falha no reenvio.'), tipo: res.ok ? 'ok' : 'erro' });
  };

  const verificarCodigo = async () => {
    setMsg(null);
    const res = await fetch('/api/aluno/autorizacao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', codigo: authzCodigo }),
    });
    const d = await res.json();
    if (!res.ok) { setMsg({ texto: d.error || 'Código incorreto.', tipo: 'erro' }); return; }
    setAuthzTermo(d.termo || null);
    setAuthzEtapa('termo');
  };

  /* ── Assinatura (canvas) ────────────────────────────────────────────────── */

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  };

  const iniciarTraco = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const c = canvasRef.current;
    if (!c) return;
    desenhandoRef.current = true;
    const ctx = c.getContext('2d');
    const { x, y } = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    try { c.setPointerCapture(e.pointerId); } catch {}
  };

  const moverTraco = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhandoRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const { x, y } = pos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setAssinaturaTrajeto(prev => [...prev.slice(-800), `${Math.round(x)},${Math.round(y)}`]);
  };

  const soltarTraco = () => {
    desenhandoRef.current = false;
    setAssinaturaTrajeto(prev => [...prev, '']);
  };

  const limparAssinatura = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setAssinaturaTrajeto([]);
  };

  const assinarTermo = async () => {
    setMsg(null);
    if (!aceite) return;
    setAssinando(true);
    try {
      const res = await fetch('/api/aluno/autorizacao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', aceite, assinatura_trajeto: assinaturaTrajeto.join(';') }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ texto: d.error || 'Erro ao assinar.', tipo: 'erro' }); return; }
      setAuthzEtapa('concluido');
      setMsg({ texto: d.message || 'Autorização concluída!', tipo: 'ok' });
      await carregar();
      onChanged?.();
    } finally {
      setAssinando(false);
    }
  };

  /* ── Responsável ────────────────────────────────────────────────────────── */

  const virarResponsavel = async () => {
    setMsg(null);
    setVirarLoading(true);
    try {
      const { ok, data } = await acao({ action: 'become-guardian', cpf: cpfResp });
      if (!ok) { setMsg({ texto: String(data?.error || 'Erro ao ativar perfil.'), tipo: 'erro' }); return; }
      setMsg({ texto: 'Perfil de responsável ativado!', tipo: 'ok' });
      setMostrarVirarResp(false);
      setCpfResp('');
      await carregar();
      onChanged?.();
    } finally {
      setVirarLoading(false);
    }
  };

  const gerarCodigoAluno = async () => {
    setMsg(null);
    const { ok, data } = await acao({ action: 'link-code' });
    if (!ok) { setMsg({ texto: String(data?.error || 'Erro ao gerar código.'), tipo: 'erro' }); return; }
    setMsg({ texto: `Seu código de autorização: ${String(data?.codigo || '')} (válido por 10 minutos). Informe ao seu responsável junto com sua matrícula.`, tipo: 'ok' });
  };

  const adicionarTutelado = async () => {
    setMsg(null);
    setAddLoading(true);
    try {
      const { ok, data } = await acao({ action: 'link-guardian', codigo, matricula, relacao });
      if (!ok) { setMsg({ texto: String(data?.error || 'Erro ao vincular.'), tipo: 'erro' }); return; }
      const aguardando = !!data?.aguardando_aluno;
      setMsg({ texto: aguardando ? String(data?.mensagem || 'Aguardando autorização do aluno.') : `Vínculo com ${String(data?.nome_aluno || 'aluno')} ativo!`, tipo: 'ok' });
      setCodigo(''); setMatricula('');
      setMostrarAdd(false);
      await carregar();
      onChanged?.();
    } finally {
      setAddLoading(false);
    }
  };

  const cadastrarNovoTutelado = async () => {
    setMsg(null);
    setNovoLoading(true);
    try {
      const res = await fetch('/api/aluno/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'criar-tutelado', ...novoForm }),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ texto: d.error || 'Erro ao cadastrar.', tipo: 'erro' }); return; }
      setNovoResultado(`${d.nome} cadastrado(a) com a matrícula ${d.matricula}. O perfil já aparece na sua lista de tutelados e no seletor "Quem está usando?".`);
      setNovoForm({ nome_completo: '', data_nascimento: '', cpf: '', nucleo: '', relacao: 'responsavel_legal' });
      await carregar();
      onChanged?.();
    } finally {
      setNovoLoading(false);
    }
  };

  const decidirVinculo = async (guardianId: string, aprovar: boolean) => {
    setMsg(null);
    const { ok, data } = await acao({ action: 'link-decide', guardian_student_id: guardianId, aprovar });
    if (!ok) { setMsg({ texto: String(data?.error || 'Erro.'), tipo: 'erro' }); return; }
    await carregar();
    onChanged?.();
  };

  const revogar = async (guardianId: string, studentId: string) => {
    if (!window.confirm('Revogar este vínculo? O acesso deixará de valer imediatamente.')) return;
    setMsg(null);
    const { ok, data } = await acao({
      action: 'link-revoke',
      guardian_student_id: guardianId === status?.student_id ? guardianId : guardianId,
      student_id: studentId,
    });
    if (!ok) { setMsg({ texto: String(data?.error || 'Erro ao revogar.'), tipo: 'erro' }); return; }
    await carregar();
    onChanged?.();
  };

  if (loading) {
    return <div style={{ ...cardStyle, textAlign: 'center', color: '#a3a3a3', fontSize: '0.85rem' }}>Carregando perfis…</div>;
  }
  if (!status) {
    return <div style={{ ...cardStyle, textAlign: 'center', color: '#a3a3a3', fontSize: '0.85rem' }}>Não foi possível carregar os perfis.</div>;
  }

  const souEuResponsavel = status.perfil_responsavel?.ativo;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {msg && (
        <div style={{
          background: msg.tipo === 'ok' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
          border: `1px solid ${msg.tipo === 'ok' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
          borderRadius: 12, padding: '11px 14px', fontSize: '0.82rem',
          color: msg.tipo === 'ok' ? '#86efac' : '#fca5a5', lineHeight: 1.5,
          display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <span style={{ display: 'flex', flexShrink: 0, marginTop: 1 }}>{msg.tipo === 'ok' ? <IconCheck size={16} /> : <IconWarn size={16} />}</span>
          <span style={{ flex: 1 }}>{msg.texto}</span>
          <button onClick={() => setMsg(null)} aria-label="Dispensar" style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 2 }}><IconX size={14} /></button>
        </div>
      )}

      {/* ── AUTORIZAÇÃO DE ADOLESCENTE (15–17) ─────────────────────────────── */}
      {status.autorizacao_status === 'necessaria_pendente' && (
        <div style={{ ...cardStyle, borderColor: 'rgba(255,146,0,0.35)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
            <span style={{ display: 'flex', color: '#FF9200' }}><IconWarn size={19} /></span>
            <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>Autorização do responsável pendente</div>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.55 }}>
            Como você tem menos de 18 anos, precisamos da autorização do seu responsável para liberar sua conta.
          </p>

          {authzEtapa === 'dados' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input aria-label="Nome completo do responsável" value={authzForm.resp_nome} onChange={e => setAuthzForm(p => ({ ...p, resp_nome: e.target.value }))} placeholder="Nome completo do responsável *" style={inputStyle} />
              <input aria-label="CPF do responsável" value={authzForm.resp_cpf} onChange={e => setAuthzForm(p => ({ ...p, resp_cpf: e.target.value }))} placeholder="CPF do responsável *" style={inputStyle} inputMode="numeric" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input aria-label="Nascimento do responsável" type="date" value={authzForm.resp_nascimento} onChange={e => setAuthzForm(p => ({ ...p, resp_nascimento: e.target.value }))} style={inputStyle} />
                <select aria-label="Parentesco" value={authzForm.resp_relacao} onChange={e => setAuthzForm(p => ({ ...p, resp_relacao: e.target.value }))} style={inputStyle}>
                  {RELACOES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                </select>
              </div>
              <input aria-label="E-mail do responsável" type="email" value={authzForm.resp_email} onChange={e => setAuthzForm(p => ({ ...p, resp_email: e.target.value }))} placeholder="E-mail do responsável (receberá o código) *" style={inputStyle} />
              <input aria-label="Telefone do responsável" value={authzForm.resp_telefone} onChange={e => setAuthzForm(p => ({ ...p, resp_telefone: e.target.value }))} placeholder="Telefone (opcional)" style={inputStyle} inputMode="tel" />
              <button onClick={enviarDadosResponsavel} disabled={virarLoading} className="press" style={btnBase}>
                {virarLoading ? 'Enviando…' : 'Enviar código ao responsável'}
              </button>
            </div>
          )}

          {authzEtapa === 'codigo' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#a3a3a3' }}>Peça o código de 6 dígitos enviado ao e-mail do responsável.</p>
              <input aria-label="Código de autorização" value={authzCodigo} onChange={e => setAuthzCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" style={{ ...inputStyle, textAlign: 'center', fontSize: '1.2rem', letterSpacing: '0.3em' }} inputMode="numeric" maxLength={6} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={verificarCodigo} className="press" style={btnBase}>Validar código</button>
                <button onClick={reenviarCodigo} className="press" style={btnGhost}>Reenviar</button>
              </div>
            </div>
          )}

          {authzEtapa === 'termo' && authzTermo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, maxHeight: 260, overflowY: 'auto' }}>
                <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: 8, color: '#ffb84d' }}>{authzTermo.titulo}</div>
                {authzTermo.corpo.map((linha, i) => (
                  <p key={i} style={{ margin: linha === '' ? '8px 0' : '4px 0', fontSize: '0.78rem', color: '#d4d4d4', lineHeight: 1.55 }}>{linha}</p>
                ))}
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: '0.8rem', color: '#e5e5e5', cursor: 'pointer' }}>
                <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2, accentColor: '#FF9200' }} />
                <span>Li e compreendi o Termo de Autorização.</span>
              </label>
              <div>
                <div style={{ fontSize: '0.78rem', color: '#a3a3a3', marginBottom: 5 }}>Assinatura do responsável (no dispositivo):</div>
                <canvas
                  ref={canvasRef}
                  width={520}
                  height={160}
                  aria-label="Área de assinatura"
                  onPointerDown={iniciarTraco}
                  onPointerMove={moverTraco}
                  onPointerUp={soltarTraco}
                  onPointerLeave={soltarTraco}
                  style={{ width: '100%', height: 130, background: 'rgba(255,255,255,0.06)', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: 12, touchAction: 'none', cursor: 'crosshair' }}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={limparAssinatura} style={btnGhost}>Limpar assinatura</button>
                </div>
                <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: '#737373' }}>
                  Você está prestes a assinar eletronicamente este documento. Data, hora, dispositivo e conta autenticada serão registrados como evidência.
                </p>
              </div>
              <button onClick={assinarTermo} disabled={!aceite || assinando || assinaturaTrajeto.length < 5} className="press"
                style={{ ...btnBase, opacity: !aceite || assinando || assinaturaTrajeto.length < 5 ? 0.5 : 1, cursor: !aceite || assinaturaTrajeto.length < 5 ? 'not-allowed' : 'pointer' }}>
                {assinando ? 'Assinando…' : 'Confirmar assinatura'}
              </button>
            </div>
          )}
        </div>
      )}

      {status.autorizacao_status === 'revogado' && (
        <div style={{ ...cardStyle, borderColor: 'rgba(239,68,68,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ display: 'flex', color: '#fca5a5' }}><IconWarn size={19} /></span>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#fca5a5' }}>Autorização revogada</div>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.5 }}>
            A autorização do seu responsável foi revogada. Suas ações ficam bloqueadas até uma nova autorização — procure o admin do seu núcleo.
          </p>
        </div>
      )}

      {status.autorizacao_status === 'autorizado' && (
        <div style={{ ...cardStyle, borderColor: 'rgba(34,197,94,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ display: 'flex', color: '#4ade80' }}><IconCheck size={19} /></span>
            <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>Conta autorizada pelo responsável</div>
          </div>
        </div>
      )}

      {/* ── RESPONSÁVEL: TUTELADOS ─────────────────────────────────────────── */}
      {souEuResponsavel && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>Meus tutelados</div>
            <button onClick={() => setMostrarAdd(v => !v)} className="press" style={{ ...btnGhost, padding: '7px 13px', fontSize: '0.78rem' }}>
              {mostrarAdd ? 'Fechar' : '+ Adicionar tutelado'}
            </button>
          </div>

          {mostrarAdd && (
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 12, padding: 13, marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                Peça o <strong>código de 6 dígitos</strong> ao aluno (ele gera no app, aqui nesta aba) e informe a <strong>matrícula</strong> dele (CCLN-000). O aluno confirma a solicitação no app dele.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input aria-label="Código do aluno" value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Código do aluno" style={inputStyle} inputMode="numeric" maxLength={6} />
                <input aria-label="Matrícula do aluno" value={matricula} onChange={e => setMatricula(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Matrícula (ex.: 012)" style={inputStyle} inputMode="numeric" maxLength={4} />
              </div>
              <select aria-label="Parentesco" value={relacao} onChange={e => setRelacao(e.target.value)} style={inputStyle}>
                {RELACOES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
              </select>
              <button onClick={adicionarTutelado} disabled={addLoading || codigo.length !== 6 || !matricula} className="press"
                style={{ ...btnBase, opacity: addLoading || codigo.length !== 6 || !matricula ? 0.5 : 1 }}>
                {addLoading ? 'Enviando…' : 'Solicitar vínculo'}
              </button>
              <button onClick={() => setMostrarNovo(v => !v)} style={{ background: 'none', border: 'none', color: '#FF9200', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left', padding: 0 }}>
                {mostrarNovo ? '− Fechar cadastro de criança' : '+ A criança ainda não tem cadastro? Cadastrar do zero'}
              </button>
              {mostrarNovo && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {novoResultado && (
                    <div style={{ background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 10, padding: '9px 12px', fontSize: '0.78rem', color: '#86efac' }}>{novoResultado}</div>
                  )}
                  <p style={{ margin: 0, fontSize: '0.74rem', color: '#737373', lineHeight: 1.5 }}>
                    Para crianças até 14 anos: cria o perfil de aluno <strong>sem conta própria</strong>, já vinculado a você. A matrícula é gerada automaticamente.
                  </p>
                  <input aria-label="Nome completo da criança" value={novoForm.nome_completo} onChange={e => setNovoForm(p => ({ ...p, nome_completo: e.target.value }))} placeholder="Nome completo da criança *" style={inputStyle} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input aria-label="Data de nascimento" type="date" value={novoForm.data_nascimento} onChange={e => setNovoForm(p => ({ ...p, data_nascimento: e.target.value }))} style={inputStyle} max={new Date().toISOString().slice(0, 10)} />
                    <input aria-label="CPF (opcional)" value={novoForm.cpf} onChange={e => setNovoForm(p => ({ ...p, cpf: e.target.value }))} placeholder="CPF (opcional)" style={inputStyle} inputMode="numeric" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <select aria-label="Núcleo" value={novoForm.nucleo} onChange={e => setNovoForm(p => ({ ...p, nucleo: e.target.value }))} style={inputStyle}>
                      <option value="">Núcleo (depois em Meus Dados)</option>
                      {nucleosLista.map(n => <option key={n.id} value={n.id}>{n.nome}</option>)}
                    </select>
                    <select aria-label="Parentesco" value={novoForm.relacao} onChange={e => setNovoForm(p => ({ ...p, relacao: e.target.value }))} style={inputStyle}>
                      {RELACOES.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
                    </select>
                  </div>
                  <button onClick={cadastrarNovoTutelado} disabled={novoLoading || !novoForm.nome_completo.trim() || !novoForm.data_nascimento} className="press"
                    style={{ ...btnBase, opacity: novoLoading || !novoForm.nome_completo.trim() || !novoForm.data_nascimento ? 0.5 : 1 }}>
                    {novoLoading ? 'Cadastrando…' : 'Cadastrar tutelado'}
                  </button>
                </div>
              )}
            </div>
          )}

          {status.tutelados.length === 0 ? (
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#737373' }}>Nenhum tutelado vinculado ainda.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {status.tutelados.map(t => (
                <div key={t.student_id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '10px 12px', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,146,0,0.12)', color: '#FF9200', flexShrink: 0, overflow: 'hidden' }}>
                    {t.foto_url
                      ? // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.foto_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <IconUser size={18} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.84rem', lineHeight: 1.3 }}>{t.nome_completo}</div>
                    <div style={{ fontSize: '0.72rem', color: '#737373' }}>
                      {t.idade != null ? `${t.idade} anos · ` : ''}{t.nucleo || 'sem núcleo'}
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 800, padding: '3px 9px', borderRadius: 999,
                    background: t.status_vinculo === 'active' ? 'rgba(34,197,94,0.12)' : 'rgba(234,179,8,0.12)',
                    color: t.status_vinculo === 'active' ? '#4ade80' : '#facc15',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {t.status_vinculo === 'active' ? 'Ativo' : 'Pendente'}
                  </span>
                  <button onClick={() => revogar(status.student_id, t.student_id)} title="Revogar acesso"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', borderRadius: 9, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>
                    Revogar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── VIRAR RESPONSÁVEL (adultos) ────────────────────────────────────── */}
      {status.pode_ser_responsavel && !souEuResponsavel && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: '0.92rem', marginBottom: 5 }}>Tornar-se responsável</div>
          <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.5 }}>
            Como responsável, você poderá adicionar e acessar perfis de alunos pelos quais é responsável, de acordo com as permissões e as regras do Ginga Gestão.
          </p>
          {!mostrarVirarResp ? (
            <button onClick={() => setMostrarVirarResp(true)} className="press" style={btnBase}>Quero ser responsável</button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <input aria-label="CPF para validar seu perfil de responsável" value={cpfResp} onChange={e => setCpfResp(e.target.value)} placeholder="Confirme seu CPF *" style={inputStyle} inputMode="numeric" />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={virarResponsavel} disabled={virarLoading} className="press" style={btnBase}>{virarLoading ? 'Ativando…' : 'Ativar perfil'}</button>
                <button onClick={() => setMostrarVirarResp(false)} style={btnGhost}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SOLICITAÇÕES RECEBIDAS (aluno autoriza responsável) ────────────── */}
      {status.vinculos_pendentes_recebidos.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: '0.92rem', marginBottom: 8 }}>Solicitações de acesso</div>
          {status.vinculos_pendentes_recebidos.map(v => (
            <div key={v.guardian_student_id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <div style={{ flex: 1, minWidth: 150, fontSize: '0.82rem' }}>
                <strong>{v.nome}</strong> quer acessar seu perfil como {v.relacao === 'mae' ? 'mãe' : v.relacao === 'pai' ? 'pai' : 'responsável'}.
              </div>
              <button onClick={() => decidirVinculo(v.guardian_student_id, true)} className="press" style={{ ...btnBase, padding: '7px 12px', fontSize: '0.76rem' }}>Autorizar</button>
              <button onClick={() => decidirVinculo(v.guardian_student_id, false)} style={{ ...btnGhost, padding: '7px 12px', fontSize: '0.76rem' }}>Recusar</button>
            </div>
          ))}
        </div>
      )}

      {/* ── CÓDIGO DO ALUNO (para o responsável vincular) ──────────────────── */}
      {!souEuResponsavel && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ display: 'flex', color: '#FF9200' }}><IconDoc size={17} /></span>
            <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>Um responsável quer me acessar?</div>
          </div>
          <p style={{ margin: '0 0 9px', fontSize: '0.8rem', color: '#a3a3a3', lineHeight: 1.5 }}>
            Gere um código e informe junto com sua matrícula ao seu responsável. Ele solicita o acesso e você autoriza aqui.
          </p>
          <button onClick={gerarCodigoAluno} className="press" style={{ ...btnGhost, fontSize: '0.8rem' }}>Gerar meu código de autorização</button>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1.5px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.05)',
  color: '#f5f5f4',
  fontSize: '0.85rem',
  boxSizing: 'border-box',
  outline: 'none',
};
