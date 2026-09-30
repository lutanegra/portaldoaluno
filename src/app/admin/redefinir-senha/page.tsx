'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function RedefinirSenhaPage() {
  const [code, setCode] = useState('');
  const [nova, setNova] = useState('');
  const [conf, setConf] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setMsg('');
    if (nova !== conf) { setErr('As senhas não coincidem.'); return; }
    if (nova.length < 6) { setErr('A nova senha deve ter pelo menos 6 caracteres.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/admin/panel-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-with-code', code, new_password: nova }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setDone(true);
        setMsg('Senha redefinida com sucesso! Você já pode entrar com a nova senha.');
      } else {
        setErr(d.error || 'Não foi possível redefinir a senha.');
      }
    } catch {
      setErr('Erro de conexão. Tente novamente.');
    }
    setLoading(false);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: '#0a0a0a' }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: 32, borderRadius: 20,
        background: 'rgba(20,18,14,0.72)', border: '1px solid rgba(255,146,0,0.22)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.55)', backdropFilter: 'blur(18px)',
      }}>
        {!done ? (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>Redefinir senha</div>
              <div style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
                Digite o código de 6 dígitos que você recebeu por e-mail e defina a nova senha.
              </div>
            </div>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="Código de 6 dígitos" required autoFocus
                style={{
                  padding: '12px 14px', borderRadius: 10, fontSize: '1.2rem', textAlign: 'center', letterSpacing: '0.4em',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', outline: 'none',
                }}
              />
              <input
                type="password" value={nova} onChange={e => setNova(e.target.value)}
                placeholder="Nova senha" required
                style={{
                  padding: '12px 14px', borderRadius: 10, fontSize: '0.95rem',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', outline: 'none',
                }}
              />
              <input
                type="password" value={conf} onChange={e => setConf(e.target.value)}
                placeholder="Confirmar nova senha" required
                style={{
                  padding: '12px 14px', borderRadius: 10, fontSize: '0.95rem',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', outline: 'none',
                }}
              />
              {err && <div style={{ color: '#f87171', fontSize: '0.85rem', textAlign: 'center' }}>{err}</div>}
              {msg && <div style={{ color: '#4ade80', fontSize: '0.85rem', textAlign: 'center' }}>{msg}</div>}
              <button
                type="submit" disabled={loading}
                style={{
                  padding: '13px', borderRadius: 10, border: 'none', cursor: loading ? 'wait' : 'pointer',
                  fontWeight: 800, fontSize: '0.95rem', color: '#0a0a0a',
                  background: 'linear-gradient(135deg,#FF9200,#ffb257)', opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Redefinindo…' : 'Redefinir senha'}
              </button>
            </form>
          </>
        ) : (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#4ade80' }}>✓ Senha alterada</div>
            <div style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.7)' }}>{msg}</div>
            <Link
              href="/admin"
              style={{
                padding: '12px', borderRadius: 10, fontWeight: 800, textDecoration: 'none',
                color: '#0a0a0a', background: 'linear-gradient(135deg,#FF9200,#ffb257)',
              }}
            >
              Ir para o login
            </Link>
            <button
              onClick={() => { setDone(false); setCode(''); setNova(''); setConf(''); setMsg(''); setErr(''); }}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Usar outro código
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
