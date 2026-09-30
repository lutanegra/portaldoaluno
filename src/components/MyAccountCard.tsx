'use client';

import { useEffect, useState } from 'react';

/**
 * "Minha Conta" — qualquer admin (owner, geral ou de núcleo) gerencia os
 * próprios dados de acesso: login, nome, e-mail (recuperação) e CPF,
 * além dos núcleos que gerencia (admin de núcleo pode vincular/desvincular).
 * A senha é trocada em bloco separado, confirmando a senha atual.
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

  // Núcleos da conta (admin de núcleo)
  const [isGeral, setIsGeral] = useState(false);
  const [meusNucleos, setMeusNucleos] = useState<string[]>([]);
  const [todosNucleos, setTodosNucleos] = useState<Array<{ slug: string; nome: string }>>([]);
  const [senhaVinculo, setSenhaVinculo] = useState('');
  const [msgVinculo, setMsgVinculo] = useState('');
  const [savingVinculo, setSavingVinculo] = useState(false);

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
  }, []);

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
      const res = await fetch('/api/admin/panel-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update-my-contact', ...authPayload({ nome, email, cpf }) }),
      });
      const d = await res.json();
      if (res.ok) {
        setMsgContact('✓ Dados atualizados!');
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

  async function acaoVinculo(action: 'link-nucleo' | 'unlink-nucleo', nucleo_slug: string) {
    if (!senhaVinculo) { setMsgVinculo('Digite sua senha para confirmar.'); return; }
    setSavingVinculo(true);
    setMsgVinculo('');
    try {
      const res = await fetch('/api/admin/panel-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...authPayload({ nucleo_slug, password: senhaVinculo }) }),
      });
      const d = await res.json();
      if (res.ok) {
        setMeusNucleos(Array.isArray(d.nucleos) ? d.nucleos : []);
        setMsgVinculo(action === 'link-nucleo' ? '✓ Núcleo vinculado!' : '✓ Núcleo desvinculado!');
        onSaved(action === 'link-nucleo' ? 'Núcleo vinculado à sua conta.' : 'Núcleo desvinculado da sua conta.');
      } else {
        setMsgVinculo(d.error || 'Erro ao atualizar vínculos.');
      }
    } catch {
      setMsgVinculo('Erro de conexão.');
    }
    setSavingVinculo(false);
    setTimeout(() => setMsgVinculo(''), 4000);
  }

  const principal = meusNucleos[0] || '';
  const disponiveis = todosNucleos.filter(n => !meusNucleos.some(m => m.toLowerCase() === String(n.slug).toLowerCase()));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: '1.3rem' }}>👤</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Meus dados de acesso</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{roleLabel} · {nucleoNome} · login <strong style={{ fontFamily: 'monospace' }}>{username}</strong></div>
          </div>
        </div>
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
        {msgContact && <div style={{ marginTop: 10, fontSize: '0.8rem', fontWeight: 600, color: msgContact.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{msgContact}</div>}
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button disabled={savingContact} onClick={salvarContato}
            style={{ padding: '9px 24px', borderRadius: 9, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 700, cursor: savingContact ? 'wait' : 'pointer', fontSize: '0.88rem', opacity: savingContact ? 0.7 : 1 }}>
            {savingContact ? '⏳ Salvando...' : '💾 Salvar meus dados'}
          </button>
        </div>
      </div>

      {!isGeral && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ fontSize: '1.3rem' }}>🔗</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Núcleos que eu gerencio</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Vincule outro núcleo à sua conta para gerenciá-lo com o mesmo login.</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
            {meusNucleos.map((slug, i) => {
              const nomeN = todosNucleos.find(n => String(n.slug).toLowerCase() === slug.toLowerCase())?.nome || slug;
              return (
                <span key={slug} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 600, background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.4)', color: '#0ea5e9' }}>
                  {i === 0 ? '★ ' : ''}{nomeN}
                  {i > 0 && (
                    <button type="button" title="Desvincular este núcleo" disabled={savingVinculo}
                      onClick={() => acaoVinculo('unlink-nucleo', slug)}
                      style={{ background: 'none', border: 'none', color: '#0ea5e9', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: 0 }}>✕</button>
                  )}
                </span>
              );
            })}
          </div>
          {disponiveis.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {disponiveis.map(n => (
                <button key={n.slug} type="button" disabled={savingVinculo}
                  onClick={() => acaoVinculo('link-nucleo', n.slug)}
                  style={{ padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  + {n.nome}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <input type="password" value={senhaVinculo} onChange={e => setSenhaVinculo(e.target.value)} placeholder="Sua senha para confirmar"
              style={{ ...inputStyle, maxWidth: 260 }} />
          </div>
          {msgVinculo && <div style={{ marginTop: 8, fontSize: '0.8rem', fontWeight: 600, color: msgVinculo.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{msgVinculo}</div>}
          <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)', marginTop: 6 }}>★ = núcleo principal (não pode ser desvinculado). A confirmação por senha vale para vincular e desvincular.</div>
        </div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ fontSize: '1.3rem' }}>🔑</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Trocar minha senha</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Confirme a senha atual e defina a nova.</div>
          </div>
        </div>
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
        {msgPass && <div style={{ marginTop: 10, fontSize: '0.8rem', fontWeight: 600, color: msgPass.startsWith('✓') ? '#22c55e' : '#ef4444' }}>{msgPass}</div>}
        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button disabled={savingPass || !senhaAtual || !novaSenha} onClick={salvarSenha}
            style={{ padding: '9px 24px', borderRadius: 9, background: 'linear-gradient(135deg,#1d4ed8,#1e40af)', border: 'none', color: '#fff', fontWeight: 700, cursor: savingPass ? 'wait' : 'pointer', fontSize: '0.88rem', opacity: savingPass || !senhaAtual || !novaSenha ? 0.7 : 1 }}>
            {savingPass ? '⏳ Alterando...' : '🔑 Trocar senha'}
          </button>
        </div>
      </div>
    </div>
  );
}
