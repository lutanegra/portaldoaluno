'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { Language, LANGUAGE_FLAGS, LANGUAGE_NAMES } from '@/lib/i18n/translations';

const LANGUAGES: Language[] = ['pt', 'pt-PT', 'en', 'es', 'fr', 'it', 'sv', 'af', 'nl', 'ja', 'ko', 'zh', 'de'];

/**
 * Botão flutuante de idioma.
 * scope="home-admin" (padrão): aparece somente na capa (/) e no painel (/admin).
 * Depois do login do aluno ele some — o idioma escolhido continua salvo.
 */
export default function LanguageButton({ scope = 'home-admin' }: { scope?: 'home-admin' }) {
  const { lang, setLang, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  useEffect(() => { setMounted(true); }, []);

  // Use 'pt' flag/label until mounted to match SSR output and avoid hydration mismatch
  const displayLang = mounted ? lang : 'pt';

  if (scope === 'home-admin') {
    const p = pathname || '/';
    const visible = p === '/' || p.startsWith('/admin');
    if (!visible) return null;
  }

  return (
    <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 9999 }}>
      {/* Dropdown menu */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: '48px',
            right: 0,
            background: 'linear-gradient(165deg, rgba(28,28,30,0.92), rgba(12,12,14,0.94))',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,146,0,0.22)',
            borderRadius: '14px',
            overflow: 'hidden',
            boxShadow: '0 14px 44px rgba(0,0,0,0.6)',
            minWidth: '190px',
            maxHeight: '400px',
            overflowY: 'auto',
          }}
        >
          {LANGUAGES.map((l) => (
            <button
              key={l}
              onClick={() => { setLang(l); setOpen(false); }}
              style={{
                width: '100%',
                padding: '9px 16px',
                background: lang === l ? 'rgba(255,146,0,0.14)' : 'transparent',
                border: 'none',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                color: lang === l ? '#FF9200' : 'rgba(255,255,255,0.85)',
                fontSize: '13px',
                fontWeight: lang === l ? 700 : 400,
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { if (lang !== l) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,146,0,0.08)'; }}
              onMouseLeave={e => { if (lang !== l) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              <span style={{ fontSize: '18px', lineHeight: 1 }}>{LANGUAGE_FLAGS[l]}</span>
              <span>{LANGUAGE_NAMES[l]}</span>
              {lang === l && <span style={{ marginLeft: 'auto', fontSize: '10px' }}>✓</span>}
            </button>
          ))}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        title={t('language_button')}
        style={{
          background: 'linear-gradient(165deg, rgba(28,28,30,0.9), rgba(10,10,12,0.92))',
          border: '1.5px solid rgba(255,146,0,0.4)',
          borderRadius: '999px',
          width: '46px',
          height: '46px',
          color: '#FF9200',
          fontSize: '19px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 18px rgba(0,0,0,0.45), 0 0 14px rgba(255,146,0,0.16)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,146,0,0.7)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.45), 0 0 20px rgba(255,146,0,0.3)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,146,0,0.4)'; e.currentTarget.style.boxShadow = '0 4px 18px rgba(0,0,0,0.45), 0 0 14px rgba(255,146,0,0.16)'; }}
      >
        <span style={{ lineHeight: 1 }}>{LANGUAGE_FLAGS[displayLang]}</span>
      </button>

      {/* Backdrop to close on outside click */}
      {open && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: -1 }}
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  );
}
