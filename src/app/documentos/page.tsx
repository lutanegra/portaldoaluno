'use client';

import { useState, useEffect } from 'react';
import { IconDoc, IconDownload, IconChevron } from '@/components/icons';

type ManualFile = { name: string; size: number; created_at: string; url: string | null };

export default function DocumentosPage() {
  const [files, setFiles] = useState<ManualFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/manual')
      .then(r => r.json())
      .then(d => { setFiles(d.files || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #0b0b0c)', fontFamily: 'inherit', padding: '28px 16px 48px' }}>
      <div style={{ maxWidth: 620, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 26 }}>
          <button
            aria-label="Voltar"
            onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.href = '/aluno'; }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)', color: '#e5e5e5', cursor: 'pointer' }}
          >
            <span style={{ display: 'flex', transform: 'rotate(180deg)' }}><IconChevron size={16} /></span>
          </button>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f5f5f4' }}>Documentos Históricos</div>
            <div style={{ fontSize: '0.75rem', color: '#8f8f8f', marginTop: 2 }}>Portal Aluno</div>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{ height: 66, borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))' }} />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', border: '1.5px dashed rgba(255,255,255,0.12)', borderRadius: 16, color: '#8f8f8f', fontSize: '0.9rem' }}>
            Nenhum documento disponível no momento.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {files.map(f => (
              <div key={f.name} style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 11, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.28), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.3)', color: '#FF9200', flexShrink: 0 }}>
                  <IconDoc size={18} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f5f5f4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {f.name.replace(/\.pdf$/i, '').replace(/_/g, ' ')}
                  </div>
                  {f.size > 0 && (
                    <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginTop: 2 }}>{(f.size / 1024).toFixed(0)} KB · PDF</div>
                  )}
                </div>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg,#FF9200,#d97706)', color: '#fff', borderRadius: 9, padding: '9px 16px', fontSize: '0.8rem', fontWeight: 700, textDecoration: 'none', flexShrink: 0, boxShadow: '0 4px 14px rgba(255,146,0,0.22)' }}>
                    <IconDownload size={14} /> Baixar
                  </a>
                ) : (
                  <span style={{ color: '#6b6b6b', fontSize: '0.75rem' }}>Indisponível</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 30, textAlign: 'center' }}>
          <a href="/aluno" style={{ color: '#6b6b6b', fontSize: '0.78rem', textDecoration: 'none' }}>← Voltar para Área do Aluno</a>
        </div>
      </div>
    </div>
  );
}
