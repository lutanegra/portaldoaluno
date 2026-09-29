'use client';

import { useState } from 'react';

/**
 * "Minha Conta" — qualquer admin (owner, geral ou de núcleo) gerencia os
 * próprios dados de acesso: login, nome, e-mail (recuperação) e CPF.
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
