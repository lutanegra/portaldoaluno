'use client';

import { useState } from 'react';

/**
 * Editor completo de uma conta de acesso do painel.
 * Campos: login, nome, e-mail, CPF e (opcionalmente) nova senha.
 * Usado na aba Contas de Acesso pelo Owner/Admin Geral.
 */
export interface EditAccountData {
  username: string;
  nome: string;
  email: string;
  cpf: string;
}

export default function EditAccountModal({
  data,
  saving,
  msg,
  onClose,
  onSave,
}: {
  data: EditAccountData;
  saving: boolean;
  msg: string;
  onClose: () => void;
  onSave: (payload: { login: string; nome: string; email: string; cpf: string; new_password?: string }) => void;
}) {
  const [login, setLogin] = useState(data.username);
  const [nome, setNome] = useState(data.nome);
  const [email, setEmail] = useState(data.email);
  const [cpf, setCpf] = useState(data.cpf);
  const [senha, setSenha] = useState('');
  const [senha2, setSenha2] = useState('');

  const senhasDivergem = senha && senha2 && senha !== senha2;
  const cpfDigits = cpf.replace(/\D/g, '');
  const emailInvalido = email.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px',
    background: 'var(--bg-input)', border: '1.5px solid var(--border)',
    borderRadius: 8, color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.72rem', fontWeight: 700,
    color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 320, padding: 20 }}>
      <div style={{ background: 'var(--bg-card)', borderRadius: 16, padding: '24px', width: '100%', maxWidth: 440, boxShadow: '0 8px 40px rgba(0,0,0,0.3)', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border)' }}>
        <h3 style={{ margin: '0 0 2px', fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>✏️ Editar conta</h3>
        <p style={{ margin: '0 0 16px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
          Altere login, nome, e-mail (recuperação), CPF (login alternativo) e senha.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={labelStyle}>Login de acesso *</label>
            <input type="text" value={login} onChange={e => setLogin(e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_.-]/g, ''))}
              placeholder="ex: joao.ciep229" style={inputStyle} />
            <div style={{ fontSize: '0.66rem', color: 'var(--text-secondary)', marginTop: 3 }}>Também pode ser usado para entrar no painel.</div>
          </div>
          <div>
            <label style={labelStyle}>Nome do responsável</label>
            <input type="text" value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>E-mail (recuperação de senha)</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com"
              style={{ ...inputStyle, borderColor: emailInvalido ? '#ef4444' : 'var(--border)' }} />
            {emailInvalido && <div style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: 3 }}>E-mail inválido.</div>}
          </div>
          <div>
            <label style={labelStyle}>CPF (login alternativo — opcional)</label>
            <input type="text" value={cpf} onChange={e => setCpf(e.target.value.replace(/\D/g, '').slice(0, 11))}
              placeholder="000.000.000-00" inputMode="numeric" style={inputStyle} />
            {cpfDigits.length > 0 && cpfDigits.length < 11 && (
              <div style={{ fontSize: '0.68rem', color: '#b45309', marginTop: 3 }}>Faltam {11 - cpfDigits.length} dígito(s).</div>
            )}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <label style={labelStyle}>Nova senha (opcional)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="Mín. 6 caracteres — vazio mantém a atual" style={inputStyle} />
              <input type="password" value={senha2} onChange={e => setSenha2(e.target.value)} placeholder="Repita" style={{ ...inputStyle, maxWidth: 120, borderColor: senhasDivergem ? '#ef4444' : 'var(--border)' }} />
            </div>
            {senhasDivergem && <div style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: 3 }}>As senhas não coincidem.</div>}
          </div>

          {msg && (
            <div style={{ borderRadius: 8, padding: '7px 12px', background: msg.startsWith('✓') ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)', border: `1px solid ${msg.startsWith('✓') ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.25)'}`, color: msg.startsWith('✓') ? '#22c55e' : '#ef4444', fontSize: '0.78rem', fontWeight: 600 }}>
              {msg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '9px 16px', borderRadius: 9, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.85rem' }}>
              Cancelar
            </button>
            <button
              disabled={saving || login.length < 3 || !!senhasDivergem || emailInvalido || (cpfDigits.length > 0 && cpfDigits.length !== 11)}
              onClick={() => onSave({ login, nome, email, cpf, new_password: senha || undefined })}
              style={{ padding: '9px 22px', borderRadius: 9, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', fontSize: '0.88rem', opacity: saving ? 0.7 : 1 }}>
              {saving ? '⏳ Salvando...' : '💾 Salvar alterações'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
