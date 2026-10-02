'use client';

/**
 * TermoAssinadoBotao — botão "Ver Termo Assinado" no modal de detalhes do
 * aluno (aba Alunos do painel). Abre a página pública do termo, que renderiza
 * o documento com a assinatura registrada (mesma tela usada para imprimir/PDF).
 */

import { useState } from 'react';

export default function TermoAssinadoBotao({ studentId }: { studentId: string }) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="detail-item detail-full" style={{ marginTop: 8 }}>
      <span className="detail-label">Termo de Responsabilidade</span>
      <span className="detail-value">
        <button
          onClick={() => {
            try {
              const base = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
              window.open(`${base}/termo?id=${encodeURIComponent(studentId)}`, '_blank', 'noopener');
            } catch {
              window.open(`/termo?id=${encodeURIComponent(studentId)}`, '_blank', 'noopener');
            }
          }}
          style={{
            background: 'rgba(34,197,94,0.10)', border: '1px solid rgba(34,197,94,0.35)',
            color: '#16a34a', borderRadius: 8, padding: '6px 13px', fontSize: '0.78rem',
            fontWeight: 700, cursor: 'pointer',
          }}
        >
          {aberto ? 'Abrir novamente' : '📄 Ver termo assinado'}
        </button>
      </span>
    </div>
  );
}
