'use client';

import { useLanguage } from '@/lib/i18n/LanguageContext';
import AppFooter from '@/components/AppFooter';

export default function Home() {
  const { t } = useLanguage();

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

        <AppFooter variante="capa" />
      </div>

      {/* Botão fixo — Painel Administrativo (redireciona para o login único em /admin) */}
      <a
        href="/admin"
        style={{
          position: 'fixed', bottom: '20px', left: '20px',
          background: 'linear-gradient(135deg,#b45309,#d97706)',
          color: '#fff', border: '1.5px solid #fbbf24', borderRadius: '8px',
          padding: '8px 14px', fontSize: '11px', cursor: 'pointer',
          zIndex: 9999, backdropFilter: 'blur(4px)', letterSpacing: '0.03em',
          fontWeight: 700, boxShadow: '0 2px 12px rgba(180,83,9,0.45)',
          textDecoration: 'none', display: 'inline-block',
        }}
      >
        🔒 {t('admin_panel_title')}
      </a>
    </div>
  );
}

