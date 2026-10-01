'use client';

import { useEffect, useState } from 'react';
import {
  IconUser, IconMail, IconLock, IconRefresh, IconCheck,
  IconMapPin, IconClock,
} from '@/components/icons';

/**
 * "Minha Conta" — gestão completa da própria conta de admin:
 * dados de acesso, senha (confirmando a atual), núcleos gerenciados
 * (somente Owner/Admin Geral alteram — o admin de núcleo só consulta),
 * preferências visuais do painel e atividade recente da conta.
 */
export default function MyAccountCard({
  username,
  nome: nomeInicial,
  email: emailInicial,
  cpf: cpfInicial,
  nucleoNome,
  roleLabel,
  onSaved,
}: {
  username: string;
  nome: string;
  email: string;
  cpf: string;
  nucleoNome: string;
  roleLabel: string;
  onSaved: (msg: string) => void;
}) {
  const [nome, setNome] = useState(nomeInicial);
  const [email, setEmail] = useState(emailInicial);
  const [cpf, setCpf] = useState(cpfInicial);
  const [savingContact, setSavingContact] = useState(false);
  const [msgContact, setMsgContact] = useState('');

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [novaSenha2, setNovaSenha2] = useState('');
  const [savingPass, setSavingPass] = useState(false);
  const [msgPass, setMsgPass] = useState('');

  // Núcleos da conta (somente leitura para admin de núcleo)
  const [isGeral, setIsGeral] = useState(false);
  const [meusNucleos, setMeusNucleos] = useState<string[]>([]);
  const [todosNucleos, setTodosNucleos] = useState<Array<{ slug: string; nome: string }>>([]);

  // Preferências visuais
  const [prefs, setPrefs] = useState({ compacto: false, glows: true });
  const [msgPrefs, setMsgPrefs] = useState('');

  // Atividade recente
  const [atividade, setAtividade] = useState<Array<{ id: string; action: string; timestamp: string; details?: string }>>([]);

  useEffect(() => {
    fetch('/api/admin/panel-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'me' }),
    })
      .then(r => r.json())
      .then(d => {
        if (!d?.authenticated) return;
        setIsGeral(d.role === 'owner' || d.role === 'admin_geral' || d.is_owner === true);
        setMeusNucleos(Array.isArray(d.nucleos) ? d.nucleos : d.nucleo ? [d.nucleo] : []);
      })
      .catch(() => {});
    fetch('/api/admin/nucleos')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.nucleos)) setTodosNucleos(d.nucleos.filter((n: { ativo: boolean }) => n.ativo).map((n: { slug: string; nome: string }) => ({ slug: n.slug, nome: n.nome }))); })
      .catch(() => {});
    try {
      const saved = localStorage.getItem('pa_panel_prefs');
      if (saved) setPrefs(p => ({ ...p, ...JSON.parse(saved) }));
    } catch {}
    fetch('/api/admin/logs')
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d)) return;
        setAtividade(
          d.filter((e: { user?: string }) => String(e.user || '').toLowerCase() === username.toLowerCase())
            .slice(0, 6)
            .map((e: { id: string; action: string; timestamp: string; details?: string }) => ({ id: e.id, action: e.action, timestamp: e.timestamp, details: e.details })),
        );
      })
      .catch(() => {});
  }, [username]);

  function salvarPrefs(next: { compacto: boolean; glows: boolean }) {
    setPrefs(next);
    try { localStorage.setItem('pa_panel_prefs', JSON.stringify(next)); } catch {}
    setMsgPrefs('✓ Preferência salva neste navegador.');
    setTimeout(() => setMsgPrefs(''), 3500);
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px',
    background: 'var(--bg-input)', border: '1.5px solid var(--border)',
    borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.72rem', fontWeight: 700,
    color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
  };
  const authPayload = (extra: Record<string, unknown> = {}) => ({ username, ...extra });

  async function salvarContato() {
    setSavingContact(true);
    setMsgContact('');
    try {
      // Envia sempre o valor exibido: o servidor ignora a máscara (***)
      // e mantém o CPF salvo quando o campo não foi alterado de verdade.
      const res = await fetch('/api/admin/panel-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-my-contact', ...authPayload({ nome, email, cpf }) }),
      });
      const d = await res.json();
      if (res.ok) {
        setMsgContact('✓ Dados atualizados!');
        if (typeof d.cpf === 'string') setCpf(d.cpf); // re-exibe mascarado
        onSaved('Minha conta atualizada.');
      } else {
        setMsgContact(d.error || 'Erro ao salvar.');
      }
    } catch {
      setMsgContact('Erro de conexão.');
    }
    setSavingContact(false);
    setTimeout(() => setMsgContact(''), 4000);
  }

  async function salvarSenha() {
    if (novaSenha.length < 6) { setMsgPass('Nova senha deve ter pelo menos 6 caracteres.'); return; }
    if (novaSenha !== novaSenha2) { setMsgPass('As senhas não coincidem.'); return; }
    setSavingPass(true);
    setMsgPass('');
    try {
      const res = await fetch('/api/admin/panel-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change-my-password', ...authPayload({ current_password: senhaAtual, new_password: novaSenha }) }),
      });
      const d = await res.json();
      if (res.ok) {
        setMsgPass('✓ Senha alterada!');
        setSenhaAtual(''); setNovaSenha(''); setNovaSenha2('');
        onSaved('Senha alterada com sucesso.');
      } else {
        setMsgPass(d.error || 'Erro ao alterar senha.');
      }
    } catch {
      setMsgPass('Erro de conexão.');
    }
    setSavingPass(false);
    setTimeout(() => setMsgPass(''), 4000);
  }

  const principal = meusNucleos[0] || '';

  const card: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22,
  };
  const cardHead = (Icon: typeof IconUser, titulo: string, sub: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.3), rgba(255,146,0,0.07))', border: '1px solid rgba(255,146,0,0.35)', color: '#FF9200', boxShadow: '0 0 14px rgba(255,146,0,0.15)', flexShrink: 0 }}>
        <Icon size={18} />
      </span>
      <div>
        <div style={{ fontWeight: 800, fontSize: '0.98rem', color: 'var(--text-primary)' }}>{titulo}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{sub}</div>
      </div>
    </div>
  );
  const status = (txt: string) => (
    <div style={{ marginTop: 10, fontSize: '0.8rem', fontWeight: 600, color: txt.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{txt}</div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Resumo da conta */}
      <div style={{ ...card, background: 'linear-gradient(140deg, rgba(255,146,0,0.09), rgba(255,255,255,0.02) 45%)' }}>
        {cardHead(IconUser, `Olá, ${nomeInicial.split(' ')[0] || username}`, `${roleLabel} · login ${username}`)}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 13px' }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Cargo</div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>{roleLabel}</div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 13px' }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Núcleo principal</div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}><IconMapPin size={12} /> {isGeral ? 'Todos os núcleos' : (todosNucleos.find(n => n.slug === principal)?.nome || nucleoNome)}</div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 13px' }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Login alternativo</div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 2, fontFamily: 'monospace' }}>{cpf || '—'}</div>
          </div>
          <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 13px' }}>
            <div style={{ fontSize: '0.66rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recuperação</div>
            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: email ? '#22c55e' : '#f59e0b', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
              <IconMail size={12} /> {email ? 'E-mail cadastrado' : 'Sem e-mail'}
            </div>
          </div>
        </div>
      </div>

      {/* Dados de acesso */}
      <div style={card}>
        {cardHead(IconUser, 'Meus dados de acesso', 'Nome, e-mail de recuperação e CPF (login alternativo)')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle}>Nome</label>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>E-mail (recuperação)</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>CPF (login alternativo)</label>
            <input type="text" value={cpf} onChange={e => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="000.000.000-00" inputMode="numeric" style={inputStyle} />
          </div>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 8 }}>
          O e-mail é usado para recuperação de acesso — mantenha-o sempre atualizado. Sem e-mail, esquecer a senha significa precisar do Owner para recuperar a conta.
        </div>
        {msgContact && status(msgContact)}
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button disabled={savingContact} onClick={salvarContato}
            style={{ padding: '9px 24px', borderRadius: 9, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 700, cursor: savingContact ? 'wait' : 'pointer', fontSize: '0.88rem', opacity: savingContact ? 0.7 : 1 }}>
            {savingContact ? 'Salvando...' : 'Salvar meus dados'}
          </button>
        </div>
      </div>

      {/* Núcleos gerenciados (somente leitura; vincular/desvincular é em Contas de Acesso) */}
      <div style={card}>
        {cardHead(IconMapPin, 'Núcleos gerenciados', isGeral ? 'Owner/Admin Geral enxergam todos os núcleos automaticamente.' : 'Definidos pelo Owner/Admin Geral — para alterar vínculos, use a aba Contas de Acesso.')}
        {isGeral ? (
          <div style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
            Como {roleLabel}, você tem alcance sobre todos os núcleos da associação — não há vínculos a gerenciar.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 6px' }}>
            {meusNucleos.map((slug, i) => {
              const nomeN = todosNucleos.find(n => String(n.slug).toLowerCase() === slug.toLowerCase())?.nome || slug;
              return (
                <span key={slug} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 13px', borderRadius: 20, fontSize: '0.79rem', fontWeight: 700, background: 'rgba(255,146,0,0.10)', border: '1px solid rgba(255,146,0,0.4)', color: '#FF9200' }}>
                  {i === 0 ? '★ ' : ''}{nomeN}
                </span>
              );
            })}
            {meusNucleos.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Nenhum núcleo vinculado.</span>}
          </div>
        )}
      </div>

      {/* Troca de senha */}
      <div style={card}>
        {cardHead(IconLock, 'Trocar minha senha', 'Confirme a senha atual e defina a nova')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle}>Senha atual</label>
            <input type="password" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Nova senha</label>
            <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} placeholder="Mín. 6 caracteres" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Confirmar nova senha</label>
            <input type="password" value={novaSenha2} onChange={e => setNovaSenha2(e.target.value)} style={inputStyle} />
          </div>
        </div>
        {msgPass && status(msgPass)}
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button disabled={savingPass || !senhaAtual || !novaSenha} onClick={salvarSenha}
            style={{ padding: '9px 24px', borderRadius: 9, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 700, cursor: savingPass ? 'wait' : 'pointer', fontSize: '0.88rem', opacity: savingPass || !senhaAtual || !novaSenha ? 0.7 : 1 }}>
            {savingPass ? 'Alterando...' : 'Trocar senha'}
          </button>
        </div>
      </div>

      {/* Preferências */}
      <div style={card}>
        {cardHead(IconClock, 'Preferências do painel', 'Ajustes visuais salvos neste navegador')}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.86rem', color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={prefs.compacto} onChange={e => salvarPrefs({ ...prefs, compacto: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#FF9200' }} />
            Modo compacto (menos espaçamento nas listas)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.86rem', color: 'var(--text-primary)' }}>
            <input type="checkbox" checked={prefs.glows} onChange={e => salvarPrefs({ ...prefs, glows: e.target.checked })} style={{ width: 16, height: 16, accentColor: '#FF9200' }} />
            Manter efeitos de brilho nos elementos ativos
          </label>
        </div>
        {msgPrefs && <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#22c55e', fontWeight: 600 }}>{msgPrefs}</div>}
      </div>

      {/* Atividade recente */}
      <div style={card}>
        {cardHead(IconRefresh, 'Minha atividade recente', 'Últimas ações registradas na Auditoria para esta conta')}
        {atividade.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>Nenhuma atividade registrada ainda.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {atividade.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 9, fontSize: '0.8rem' }}>
                <IconCheck size={13} style={{ color: '#FF9200', flexShrink: 0 }} />
                <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{a.action}</span>
                <span style={{ color: 'var(--text-tertiary)', marginLeft: 'auto', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                  {new Date(a.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
