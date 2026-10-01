'use client';

import { useEffect, useState } from 'react';
import { APP_VERSION, APP_RELEASE_DATE } from '@/lib/version';
import { CHANGELOG, CATEGORIA_META } from '@/components/changelog';
import { IconShieldCheck } from '@/components/icons';

/**
 * Card "Versões e Atualizações" — área administrativa informativa do changelog.
 * A versão e o histórico NÃO dependem de edição manual: a fonte de verdade é o
 * código (src/lib/version.ts + src/components/changelog.ts), atualizada a cada
 * implementação relevante. Aqui o admin apenas consulta.
 */
export default function VersionsCard() {
  const ano = new Date().getFullYear();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Versão atual */}
      <div style={{ background: 'linear-gradient(160deg, rgba(255,146,0,0.10), rgba(255,255,255,0.03))', border: '1px solid rgba(255,146,0,0.3)', borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, boxShadow: '0 0 24px rgba(255,146,0,0.06)' }}>
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 44, height: 44, borderRadius: 13, background: 'rgba(255,146,0,0.14)', border: '1px solid rgba(255,146,0,0.4)', color: '#FF9200' }}>
          <IconShieldCheck size={22} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f5f5f4' }}>
            Versão atual: <span style={{ color: '#FF9200' }}>v{APP_VERSION}</span>
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 2 }}>
            Publicada em {APP_RELEASE_DATE.split('-').reverse().join('/')} · oficial do sistema
          </div>
        </div>
        <span style={{ fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#4ade80', background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 999, padding: '3px 10px' }}>
          Estável
        </span>
      </div>

      {/* Explicação do versionamento */}
      <div style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '13px 16px', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        O versionamento segue o padrão <strong style={{ color: 'var(--text-primary)' }}>MAJOR.MINOR.PATCH</strong>: correções sobem o último número, recursos novos sobem o do meio e reformulações grandes sobem o primeiro. Cada implementação relevante do sistema gera uma nova versão registrada no histórico abaixo — não é preciso cadastrar nada aqui.
      </div>

      {/* Histórico */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.09em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          Histórico de versões ({CHANGELOG.length})
        </div>
        {CHANGELOG.map((entry, ei) => {
          const grupos = ['novo', 'melhorias', 'interface', 'correcoes', 'seguranca', 'desempenho']
            .map(cat => ({ cat, itens: entry.itens.filter(i => i.categoria === cat) }))
            .filter(g => g.itens.length > 0);
          return (
            <div key={entry.versao} style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 800, color: ei === 0 ? '#FF9200' : '#f5f5f4' }}>v{entry.versao}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{entry.data.split('-').reverse().join('/')}</span>
                {ei === 0 && (
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4ade80', background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 999, padding: '2px 8px' }}>Atual</span>
                )}
              </div>
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#f5f5f4', margin: '5px 0 3px' }}>{entry.titulo}</div>
              <p style={{ margin: 0, fontSize: '0.78rem', lineHeight: 1.55, color: 'var(--text-secondary)' }}>{entry.descricao}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {grupos.map(({ cat, itens }) => {
                  const meta = CATEGORIA_META[cat as keyof typeof CATEGORIA_META];
                  return (
                    <div key={cat}>
                      <span style={{ display: 'inline-block', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: meta.cor, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 999, padding: '2px 8px', marginBottom: 5 }}>{meta.label}</span>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {itens.map((item, ii) => (
                          <li key={ii} style={{ display: 'flex', gap: 7, fontSize: '0.76rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                            <span aria-hidden="true" style={{ color: meta.cor, flexShrink: 0 }}>•</span>
                            <span>{item.texto}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary, #8f8f8f)', textAlign: 'center', lineHeight: 1.6 }}>
        © {ano} Ginga Gestão · v{APP_VERSION}
      </div>
    </div>
  );
}
