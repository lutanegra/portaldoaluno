'use client';

import { useState } from 'react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function Home() {
  const { t } = useLanguage();
  // Modal admin (owner / admin geral / núcleo)
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminScreen, setAdminScreen] = useState<'login' | 'change' | 'recover'>('login');
  const [adminUser, setAdminUser] = useState('');
  const [adminPass, setAdminPass] = useState('');
  const [adminShowPass, setAdminShowPass] = useState(false);
  const [adminErro, setAdminErro] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminChgCurrent, setAdminChgCurrent] = useState('');
  const [adminChgNew, setAdminChgNew] = useState('');
  const [adminChgConfirm, setAdminChgConfirm] = useState('');
  const [adminChgMsg, setAdminChgMsg] = useState('');
  const [chgSaving, setChgSaving] = useState(false);
  const [recAdminUser, setRecAdminUser] = useState('');
  const [recAdminPass, setRecAdminPass] = useState('');
  const [recTargetUser, setRecTargetUser] = useState('');
  const [recNewPass, setRecNewPass] = useState('');
  const [recMsg, setRecMsg] = useState('');
  const [recSaving, setRecSaving] = useState(false);


  async function handleAdminAccess() {
    if (!adminUser.trim() || !adminPass) { setAdminErro('Preencha usuário e senha.'); return; }
    setAdminLoading(true);
    setAdminErro('');
    try {
      const res = await fetch('/api/admin/panel-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', username: adminUser.trim(), password: adminPass }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        sessionStorage.setItem('admin_auth', data.nucleo);
        sessionStorage.setItem('admin_user', adminUser.trim());
        sessionStorage.setItem('admin_is_owner', data.isOwner ? 'true' : 'false');
        sessionStorage.setItem('admin_auth_nucleos', JSON.stringify(data.isGeral ? ['geral'] : [data.nucleo]));
        if (data.first_login) {
          setAdminScreen('change');
          setAdminLoading(false);
          return;
        }
        window.location.href = '/admin';
        return;
      }
      setAdminErro(data.error || 'Usuário ou senha incorretos.');
    } catch {
      setAdminErro('Erro de conexão. Tente novamente.');
    }
    setAdminPass('');
    setAdminLoading(false);
  }

  return (
    <>
      {/* ── Capa — Portal Aluno ── */}
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
        <div style={{ width: '100%', maxWidth: 430, textAlign: 'center' }}>
          {/* Logo */}
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo-portal-aluno.png"
              alt="Portal Aluno"
              style={{ width: 108, height: 108, objectFit: 'contain', margin: '0 auto 18px', display: 'block', filter: 'drop-shadow(0 8px 24px rgba(255,146,0,0.35))' }}
            />
            <h1 className="hero-title" style={{ marginBottom: 8 }}>PORTAL <span style={{ color: 'var(--accent)' }}>ALUNO</span></h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', margin: '0 auto 28px', maxWidth: 420 }}>
              {t('form_subtitle')}
            </p>
          </div>

          {/* Ações principais */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 340, margin: '0 auto' }}>
            <a
              href="/aluno"
              className="pa-btn"
              style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px' }}
            >
              Entrar ou criar minha conta
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            </a>
            <a
              href="/verificar"
              className="pa-btn-ghost"
              style={{ textAlign: 'center', padding: '10px 0', fontSize: '0.9rem' }}
            >
              Verificar carteirinha →
            </a>
          </div>

        </div>
      </div>

      {/* Botão fixo — Painel Administrativo */}
      <button
        onClick={() => { setAdminModalOpen(true); setAdminErro(''); setAdminScreen('login'); }}
        style={{
          position: 'fixed', bottom: '20px', left: '20px',
          background: 'linear-gradient(135deg,#b45309,#d97706)',
          color: '#fff', border: '1.5px solid #fbbf24', borderRadius: '8px',
          padding: '8px 14px', fontSize: '11px', cursor: 'pointer',
          zIndex: 9999, backdropFilter: 'blur(4px)', letterSpacing: '0.03em',
          fontWeight: 700, boxShadow: '0 2px 12px rgba(180,83,9,0.45)',
        }}
      >
        🔒 {t('admin_panel_title')}
      </button>

      {adminModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}
          onClick={e => { if (e.target === e.currentTarget) { setAdminModalOpen(false); setAdminLoading(false); setAdminScreen('login'); } }}
        >
          <div style={{ background: 'linear-gradient(160deg,#1a1a2e,#16213e)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '28px 26px', width: 520, maxWidth: '96vw', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 24px 80px rgba(0,0,0,0.6)', maxHeight: '92vh', overflowY: 'auto' }}>

            {/* ── LOGIN ── */}
            {adminScreen === 'login' && (
              <>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>🔐</div>
                  <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.05rem', marginBottom: 2 }}>{t('admin_panel_title')}</div>
                  <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.73rem' }}>{t('admin_access_profiles')}</div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 12 }}>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.68rem', marginBottom: 10, textAlign: 'center', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{t('admin_geral_login')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.72rem', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('admin_login_label')}</div>
                      <input autoFocus value={adminUser} onChange={e => { setAdminUser(e.target.value); setAdminErro(''); }}
                        onKeyDown={e => { if (e.key === 'Enter') handleAdminAccess(); }}
                        placeholder="owner, admin ou login do núcleo" disabled={adminLoading}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 9, color: '#fff', fontSize: '0.95rem', outline: 'none' }} />
                    </div>
                    <div>
                      <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.72rem', fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('admin_password')}</div>
                      <div style={{ position: 'relative' }}>
                        <input id="adminPassInput" type={adminShowPass ? 'text' : 'password'} value={adminPass} onChange={e => { setAdminPass(e.target.value); setAdminErro(''); }}
                          onKeyDown={e => { if (e.key === 'Enter') handleAdminAccess(); }}
                          placeholder="••••••••" disabled={adminLoading}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 40px 10px 14px', background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.14)', borderRadius: 9, color: '#fff', fontSize: '0.95rem', outline: 'none' }} />
                        <button type="button" onClick={() => setAdminShowPass(v => !v)}
                          style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: '0.85rem', padding: 0 }}>
                          {adminShowPass ? '🙈' : '👁'}
                        </button>
                      </div>
                    </div>
                  </div>
                  {adminErro && <div style={{ marginTop: 8, background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '8px 12px', color: '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>⚠ {adminErro}</div>}
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button onClick={() => { setAdminModalOpen(false); setAdminLoading(false); setAdminUser(''); setAdminPass(''); setAdminErro(''); }}
                      style={{ flex: 1, padding: '10px', borderRadius: 9, background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', color: '#aaa', cursor: 'pointer', fontSize: '0.85rem' }}>
                      {t('admin_cancel_btn')}
                    </button>
                    <button onClick={handleAdminAccess} disabled={adminLoading}
                      style={{ flex: 2, padding: '10px', borderRadius: 9, background: 'linear-gradient(135deg,#b45309,#d97706)', border: 'none', color: '#fff', cursor: adminLoading ? 'not-allowed' : 'pointer', fontSize: '0.9rem', fontWeight: 700, opacity: adminLoading ? 0.7 : 1 }}>
                      {adminLoading ? t('admin_verifying') : t('admin_enter_as')}
                    </button>
                  </div>
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 10, marginTop: 4, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => { setAdminScreen('change'); setAdminChgMsg(''); setAdminChgCurrent(''); setAdminChgNew(''); setAdminChgConfirm(''); }}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 7, padding: '6px 13px', fontSize: '0.73rem', cursor: 'pointer', fontWeight: 600 }}>
                      {t('admin_change_password')}
                    </button>
                    <button onClick={() => { setAdminScreen('recover'); setRecMsg(''); setRecAdminUser(''); setRecAdminPass(''); setRecTargetUser(''); setRecNewPass(''); }}
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)', borderRadius: 7, padding: '6px 13px', fontSize: '0.73rem', cursor: 'pointer', fontWeight: 600 }}>
                      {t('admin_reset_password')}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* ── ALTERAR MINHA SENHA ── */}
            {adminScreen === 'change' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setAdminScreen('login')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>←</button>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 800, fontSize: '0.95rem' }}>🔑 Alterar Minha Senha</div>
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem' }}>Use sua senha atual para definir uma nova</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Login', val: adminUser, set: setAdminUser, ph: 'owner, admin ou login do núcleo', pw: false },
                    { label: 'Senha Atual', val: adminChgCurrent, set: setAdminChgCurrent, ph: '••••••••', pw: true },
                    { label: 'Nova Senha', val: adminChgNew, set: setAdminChgNew, ph: 'mínimo 6 caracteres', pw: true },
                    { label: 'Confirmar Nova Senha', val: adminChgConfirm, set: setAdminChgConfirm, ph: '••••••••', pw: true },
                  ].map(f => (
                    <div key={f.label}>
                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>
                      <input type={f.pw ? 'password' : 'text'} value={f.val} onChange={e => { f.set(e.target.value); setAdminChgMsg(''); }}
                        placeholder={f.ph}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 13px', background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', borderRadius: 8, color: '#fff', fontSize: '0.9rem', outline: 'none' }} />
                    </div>
                  ))}
                </div>
                {adminChgMsg && <div style={{ borderRadius: 8, padding: '8px 12px', background: adminChgMsg.startsWith('✓') ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)', border: `1px solid ${adminChgMsg.startsWith('✓') ? 'rgba(22,163,74,0.35)' : 'rgba(220,38,38,0.3)'}`, color: adminChgMsg.startsWith('✓') ? '#4ade80' : '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>{adminChgMsg}</div>}
                <button disabled={chgSaving} onClick={async () => {
                  if (!adminUser || !adminChgCurrent || !adminChgNew || !adminChgConfirm) { setAdminChgMsg('Preencha todos os campos.'); return; }
                  if (adminChgNew !== adminChgConfirm) { setAdminChgMsg('As senhas não coincidem.'); return; }
                  if (adminChgNew.length < 6) { setAdminChgMsg('Nova senha deve ter mínimo 6 caracteres.'); return; }
                  setChgSaving(true);
                  try {
                    const res = await fetch('/api/admin/panel-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'change-password', username: adminUser.trim().toLowerCase(), current_password: adminChgCurrent, new_password: adminChgNew }) });
                    const d = await res.json();
                    setAdminChgMsg(res.ok ? '✓ Senha alterada com sucesso! Faça login com a nova senha.' : (d.error || 'Erro ao alterar senha.'));
                    if (res.ok) { setAdminChgCurrent(''); setAdminChgNew(''); setAdminChgConfirm(''); }
                  } catch {
                    setAdminChgMsg('Erro de conexão. Tente novamente.');
                  }
                  setChgSaving(false);
                }} style={{ padding: '10px', borderRadius: 9, background: 'linear-gradient(135deg,#1d4ed8,#1e40af)', border: 'none', color: '#fff', fontWeight: 700, fontSize: '0.9rem', cursor: chgSaving ? 'wait' : 'pointer', opacity: chgSaving ? 0.7 : 1 }}>
                  {chgSaving ? '⏳ Salvando...' : '✅ Salvar Nova Senha'}
                </button>
              </>
            )}

            {/* ── REDEFINIR SENHA (Admin Geral redefine senha de qualquer usuário) ── */}
            {adminScreen === 'recover' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <button onClick={() => setAdminScreen('login')} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>←</button>
                  <div>
                    <div style={{ color: '#fff', fontWeight: 800, fontSize: '0.95rem' }}>🔄 Redefinir Senha</div>
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.7rem' }}>Somente o Admin Geral pode redefinir senhas de outros</div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { label: 'Usuário Admin Geral', val: recAdminUser, set: setRecAdminUser, ph: 'admin', pw: false },
                    { label: 'Senha do Admin Geral', val: recAdminPass, set: setRecAdminPass, ph: '••••••••', pw: true },
                    { label: 'Usuário para Redefinir', val: recTargetUser, set: setRecTargetUser, ph: 'ex: login do núcleo', pw: false },
                    { label: 'Nova Senha para o Usuário', val: recNewPass, set: setRecNewPass, ph: 'mínimo 6 caracteres', pw: true },
                  ].map(f => (
                    <div key={f.label}>
                      <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem', fontWeight: 600, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</div>
                      <input type={f.pw ? 'password' : 'text'} value={f.val} onChange={e => { f.set(e.target.value); setRecMsg(''); }}
                        placeholder={f.ph}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 13px', background: 'rgba(255,255,255,0.07)', border: '1.5px solid rgba(255,255,255,0.13)', borderRadius: 8, color: '#fff', fontSize: '0.9rem', outline: 'none' }} />
                    </div>
                  ))}
                </div>
                {recMsg && <div style={{ borderRadius: 8, padding: '8px 12px', background: recMsg.startsWith('✓') ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)', border: `1px solid ${recMsg.startsWith('✓') ? 'rgba(22,163,74,0.35)' : 'rgba(220,38,38,0.3)'}`, color: recMsg.startsWith('✓') ? '#4ade80' : '#f87171', fontSize: '0.78rem', fontWeight: 600 }}>{recMsg}</div>}
                <button disabled={recSaving} onClick={async () => {
                  if (!recAdminUser || !recAdminPass || !recTargetUser || !recNewPass) { setRecMsg('Preencha todos os campos.'); return; }
                  if (recNewPass.length < 6) { setRecMsg('Nova senha deve ter mínimo 6 caracteres.'); return; }
                  setRecSaving(true);
                  try {
                    const res = await fetch('/api/admin/panel-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reset-password', admin_username: recAdminUser, admin_password: recAdminPass, target_username: recTargetUser, new_password: recNewPass }) });
                    const d = await res.json();
                    setRecMsg(res.ok ? `✓ Senha de "${recTargetUser}" redefinida com sucesso!` : (d.error || 'Erro ao redefinir senha.'));
                    if (res.ok) { setRecTargetUser(''); setRecNewPass(''); }
                  } catch {
                    setRecMsg('Erro de conexão. Tente novamente.');
                  }
                  setRecSaving(false);
                }} style={{ padding: '10px', borderRadius: 9, background: 'linear-gradient(135deg,#b45309,#d97706)', border: 'none', color: '#fff', cursor: recSaving ? 'wait' : 'pointer', fontWeight: 700, fontSize: '0.9rem', opacity: recSaving ? 0.7 : 1 }}>
                  {recSaving ? '⏳ Redefinindo...' : '🔄 Redefinir Senha'}
                </button>
              </>
            )}

          </div>
        </div>
      )}
    </>
  );
}
