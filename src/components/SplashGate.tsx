'use client';

import { useEffect, useState } from 'react';

const SPLASH_KEY = 'pa_splash_shown_at';
const SPLASH_INTERVAL_MS = 30 * 60 * 1000; // mostra novamente a cada 30 min de inatividade

/**
 * Tela de carregamento do Portal Aluno: logo com anel animado + nome.
 * Aparece na primeira visita da sessão do navegador; o app por baixo
 * continua carregando normalmente.
 */
export default function SplashGate() {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem(SPLASH_KEY) || 0);
      const now = Date.now();
      if (!last || now - last > SPLASH_INTERVAL_MS) {
        sessionStorage.setItem(SPLASH_KEY, String(now));
        setVisible(true);
        document.body.style.overflow = 'hidden';
        const t1 = window.setTimeout(() => setLeaving(true), 1900);
        const t2 = window.setTimeout(() => {
          setVisible(false);
          document.body.style.overflow = '';
        }, 2350);
        return () => { window.clearTimeout(t1); window.clearTimeout(t2); document.body.style.overflow = ''; };
      }
    } catch {
      // sessionStorage indisponível — não bloqueia o app
    }
  }, []);

  if (!visible) return null;

  return (
    <div className={`pa-splash${leaving ? ' leaving' : ''}`} aria-hidden="true">
      <div className="pa-splash-ring">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-portal-aluno.svg" alt="" />
      </div>
      <div className="pa-splash-name">Portal <span>Aluno</span></div>
      <div className="pa-splash-bar"><i /></div>
    </div>
  );
}
