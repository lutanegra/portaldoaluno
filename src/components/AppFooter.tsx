'use client';

import { useCallback, useEffect, useState } from 'react';
import { APP_VERSION } from '@/lib/version';
import { CHANGELOG, changelogParaAluno, versaoReferenciaAluno, CATEGORIA_META, type ChangelogCategoria, type ChangelogEntry } from './changelog';

/**
 * Rodapé oficial do sistema: © com ano automático + versão.
 * Na capa (variante="capa") inclui o botão "✦ Novidades", que abre o changelog
 * e exibe um pontinho enquanto houver versão nova não visualizada.
 */

const SEEN_KEY = 'pa_changelog_visto';

function lerVisto(): string {
  try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; }
}

/**
 * Hook do indicador: verdadeiro quando há novidade (na visão do ALUNO) ainda não vista.
 * Compara com a versão de referência do aluno, não com a versão bruta do sistema —
 * lançamentos internos (só painel/infra) não devem acender o ponto para quem treina.
 */
export function useNovidades() {
  const [visto, setVisto] = useState<string | null>(null);

  useEffect(() => {
    setVisto(lerVisto());
    const sync = () => setVisto(lerVisto());
    window.addEventListener('pa-changelog-visto', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('pa-changelog-visto', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const marcarVista = useCallback(() => {
    const referencia = versaoReferenciaAluno();
    try { localStorage.setItem(SEEN_KEY, referencia); } catch {}
    setVisto(referencia);
    try { window.dispatchEvent(new Event('pa-changelog-visto')); } catch {}
  }, []);

  return { temNovidade: visto !== null && visto !== versaoReferenciaAluno(), marcarVista };
}

const ORDEM_CATEGORIAS: ChangelogCategoria[] = ['novo', 'melhorias', 'interface', 'correcoes', 'seguranca', 'desempenho'];

function dataBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Modal do histórico de versões (mais recente primeiro). Visão do ALUNO: sem itens do painel/infra. */
export function ChangelogModal({ open, onClose, aoAbrir }: { open: boolean; onClose: () => void; aoAbrir?: () => void }) {
  useEffect(() => {
    if (!open) return;
    aoAbrir?.();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose, aoAbrir]);

  if (!open) return null;

  const visivel: ChangelogEntry[] = changelogParaAluno();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Histórico de novidades"
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 620, maxHeight: '84vh', overflowY: 'auto',
          background: 'linear-gradient(165deg, rgba(28,28,31,0.96), rgba(14,14,16,0.98))',
          border: '1px solid rgba(255,255,255,0.10)', borderRadius: 22,
          boxShadow: '0 30px 90px rgba(0,0,0,0.7), 0 0 40px rgba(255,146,0,0.07)',
        }}
      >
        {/* Cabeçalho */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '18px 22px 14px', background: 'linear-gradient(180deg, rgba(20,20,23,0.98) 70%, rgba(20,20,23,0.88))', borderBottom: '1px solid rgba(255,255,255,0.07)', borderRadius: '22px 22px 0 0' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.02rem', fontWeight: 800, color: '#f5f5f4' }}>
              <span style={{ color: '#FF9200' }}>✦</span> Novidades
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#FF9200', background: 'rgba(255,146,0,0.12)', border: '1px solid rgba(255,146,0,0.35)', borderRadius: 999, padding: '2px 9px' }}>v{versaoReferenciaAluno()}</span>
            </div>
            <div style={{ fontSize: '0.74rem', color: '#8f8f8f', marginTop: 2 }}>Histórico de atualizações do sistema</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar novidades"
            className="press"
            style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)', color: '#d4d4d4', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Entradas (somente o que interessa ao aluno) */}
        <div style={{ padding: '16px 18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {visivel.map((entry, ei) => {
            const grupos = ORDEM_CATEGORIAS
              .map(cat => ({ cat, itens: entry.itens.filter(i => i.categoria === cat) }))
              .filter(g => g.itens.length > 0);
            return (
              <div
                key={entry.versao}
                style={{
                  background: 'rgba(255,255,255,0.035)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16,
                  padding: '16px 18px',
                  boxShadow: ei === 0 ? '0 0 24px rgba(255,146,0,0.06)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: 800, color: ei === 0 ? '#FF9200' : '#f5f5f4' }}>v{entry.versao}</span>
                  <span style={{ fontSize: '0.72rem', color: '#8f8f8f' }}>{dataBR(entry.data)}</span>
                  {ei === 0 && (
                    <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4ade80', background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 999, padding: '2px 8px' }}>Atual</span>
                  )}
                </div>
                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f5f5f4', margin: '6px 0 4px' }}>{entry.titulo}</div>
                <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.55, color: '#b3b3b3' }}>{entry.descricao}</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                  {grupos.map(({ cat, itens }) => {
                    const meta = CATEGORIA_META[cat];
                    return (
                      <div key={cat}>
                        <span style={{ display: 'inline-block', fontSize: '0.64rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: meta.cor, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 999, padding: '2px 9px', marginBottom: 6 }}>
                          {meta.label}
                        </span>
                        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {itens.map((item, ii) => (
                            <li key={ii} style={{ display: 'flex', gap: 8, fontSize: '0.79rem', lineHeight: 1.5, color: '#cfcfcf' }}>
                              <span aria-hidden="true" style={{ color: meta.cor, flexShrink: 0, marginTop: 1 }}>•</span>
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
      </div>
    </div>
  );
}

/** Rodapé oficial — usar em todas as telas de entrada do sistema. */
export default function AppFooter({ variante = 'simples', abrirAutomaticamente = false, onFechar }: { variante?: 'capa' | 'simples'; abrirAutomaticamente?: boolean; onFechar?: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const { temNovidade, marcarVista } = useNovidades();
  const ano = new Date().getFullYear();

  useEffect(() => {
    if (abrirAutomaticamente) setModalOpen(true);
  }, [abrirAutomaticamente]);

  const fechar = () => {
    setModalOpen(false);
    onFechar?.();
  };

  return (
    <>
      <div style={{ marginTop: 26, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '0 16px' }}>
        {variante === 'capa' && (
          <button
            type="button"
            onClick={() => { setModalOpen(true); marcarVista(); }}
            className="press"
            style={{
              position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 7,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,146,0,0.35)',
              color: '#FF9200', borderRadius: 999, padding: '8px 18px',
              fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 0 18px rgba(255,146,0,0.10)',
            }}
          >
            ✦ Novidades
            {temNovidade && (
              <span aria-label="Nova versão disponível" style={{ position: 'absolute', top: -3, right: -1, width: 10, height: 10, borderRadius: '50%', background: '#FF9200', boxShadow: '0 0 8px rgba(255,146,0,0.8)' }} />
            )}
          </button>
        )}
          <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.32)', lineHeight: 1.7 }}>
            © {ano} Ginga Gestão · Todos os direitos reservados.
            <br />
            <span style={{ color: 'rgba(255,255,255,0.24)' }}>v{APP_VERSION}</span>
          </div>
        </div>

      <ChangelogModal
        open={modalOpen}
        onClose={fechar}
        aoAbrir={() => marcarVista()}
      />
    </>
  );
}
