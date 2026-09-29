'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function AdminRedefinirSenhaPage() {
  const [status, setStatus] = useState<'loading' | 'form' | 'erro' | 'ok'>('loading');
  const [erroMsg, setErroMsg] = useState('');
  const [nova, setNova] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // O Supabase entrega o access_token no fragmento (#access_token=...) do redirect
  useEffect(() => {
    try {
      const frag = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      const token = frag.get('access_token');
      const erro = frag.get('error_description') || frag.get('error');
      if (erro) {
        setErroMsg(erro);
        setStatus('erro');
        return;
      }
      if (!token) {
        setErroMsg('Link inválido ou já utilizado. Solicite um novo em "Esqueci minha senha" no painel.');
        setStatus('erro');
        return;
      }
      try { window.localStorage.setItem('pa_reset_token', token); } catch {}
      setStatus('form');
    } catch {
      setErroMsg('Não foi possível validar o link. Solicite um novo.');
      setStatus('erro');
    }
  }, []);

  async function salvar() {
    if (nova.length < 6) { setMsg('A senha deve ter pelo menos 6 caracteres.'); return; }
    if (nova !== confirmar) { setMsg('As senhas não coincidem.'); return; }
    setSaving(true); setMsg('');
    try {
      let token = '';
      try { token = window.localStorage.getItem('pa_reset_token') || ''; } catch {}
      const res = await fetch('/api/admin/panel-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-by-tokens', access_token: token, new_password: nova }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        try { window.localStorage.removeItem('pa_reset_token'); } catch {}
        setStatus('ok');
      } else {
        setMsg(data.error || 'Erro ao redefinir a senha.');
      }
    } catch {
      setMsg('Erro de conexão. Tente novamente.');
    }
    setSaving(false);
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 20px',
        background: 'radial-gradient(900px 500px at 50% -10%, rgba(255,146,0,0.16), transparent 60%), #0a0a0a',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-portal-aluno.png" alt="Portal Aluno" style={{ width: 76, height: 76, objectFit: 'contain', margin: '0 auto 14px', display: 'block' }} />
          <h1 style={{ color: '#fff', fontSize: '1.25rem', fontWeight: 800, margin: 0 }}>
            Redefinir senha do painel
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.82rem', marginTop: 6 }}>
            Portal Aluno · Acesso administrativo
          </p>
        </div>

        <div style={{ background: 'linear-gradient(160deg,#161616,#0f0f0f)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '26px 24px', boxShadow: '0 24px 80px rgba(0,0,0,0.6)' }}>
          {status === 'loading' && (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem', padding: '18px 0' }}>
              Validando seu link de redefinição...
            </div>
          )}

          {status === 'erro' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>⚠️</div>
              <div style={{ color: '#fca5a5', fontSize: '0.85rem', lineHeight: 1.6, marginBottom: 18 }}>{erroMsg}</div>
              <Link href="/admin" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#FF9200,#d97706)', color: '#fff', borderRadius: 9, padding: '11px 22px', fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none' }}>
                Voltar ao painel
              </Link>
            </div>
          )}

          {status === 'form' && (
            <form onSubmit={e => { e.preventDefault(); salvar(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ display: 'block', color: 'rgba(255,255,255,0.55)', fontSize: '0.72rem', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nova senha</label>
                <input type="password" value={nova} onChange={e => { setNova(e.target.value); setMsg(''); }}
                  placeholder="mínimo 6 caracteres"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 9, color: '#fff', fontSize: '0.95rem', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', color: 'rgba(255,255,255,0.55)', fontSize: '0.72rem', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Confirmar nova senha</label>
                <input type="password" value={confirmar} onChange={e => { setConfirmar(e.target.value); setMsg(''); }}
                  placeholder="repita a nova senha"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 9, color: '#fff', fontSize: '0.95rem', outline: 'none' }} />
              </div>
              {msg && <div style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '8px 12px', color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>⚠ {msg}</div>}
              <button type="submit" disabled={saving}
                style={{ padding: '12px', borderRadius: 9, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.92rem', cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, marginTop: 4 }}>
                {saving ? '⏳ Salvando...' : '✅ Definir nova senha'}
              </button>
            </form>
          )}

          {status === 'ok' && (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 10 }}>✅</div>
              <div style={{ color: '#86efac', fontSize: '0.9rem', fontWeight: 700, marginBottom: 6 }}>Senha redefinida com sucesso!</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem', marginBottom: 18 }}>Use a nova senha para entrar no painel.</div>
              <Link href="/admin" style={{ display: 'inline-block', background: 'linear-gradient(135deg,#FF9200,#d97706)', color: '#fff', borderRadius: 9, padding: '11px 22px', fontWeight: 700, fontSize: '0.88rem', textDecoration: 'none' }}>
                Entrar no painel
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
