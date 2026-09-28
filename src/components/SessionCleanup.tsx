'use client';

import { useEffect } from 'react';

/**
 * Migração de sessões antigas: remove tokens legados (sessionStorage /
 * localStorage) que não correspondem mais ao cookie de sessão atual.
 * Roda uma vez por carregamento, de forma silenciosa.
 */
export default function SessionCleanup() {
  useEffect(() => {
    try {
      sessionStorage.removeItem('aluno_session');
      localStorage.removeItem('aluno_session');
      // Token de pré-visualização administrativo continua válido — não mexer.
    } catch {
      // storage indisponível
    }
  }, []);
  return null;
}
