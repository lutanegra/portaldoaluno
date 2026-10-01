'use client';

/**
 * CENTRAL DE NOTIFICAÇÕES — sino, histórico, preferências e dispositivos.
 * Usada no app do aluno e no painel (a API autentica por cookie de sessão do
 * aluno; no painel o acesso é pela conta autenticada equivalente).
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconBell, IconX, IconCheck, IconGear, IconWarn, IconTrash } from '@/components/icons';
import { usePush, type PushState } from '@/hooks/usePush';
import { changelogParaAluno, versaoReferenciaAluno, CATEGORIA_META as CHANGELOG_META, type ChangelogCategoria } from '@/components/changelog';

export type NotificacaoItem = {
  id: string;
  type: string;
  category: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
  target_type: string;
  target_id: string;
};

export type DispositivoItem = {
  id: string;
  device_name: string;
  created_at: string;
  last_seen_at: string;
  active: boolean;
  user_agent: string;
};

type Preferencias = {
  mural_enabled: boolean;
  events_enabled: boolean;
  attendance_enabled: boolean;
  justification_enabled: boolean;
  graduation_enabled: boolean;
  guardian_enabled: boolean;
  system_enabled: boolean;
} | null;

const CAT_META: Record<string, { label: string; cor: string }> = {
  seguranca: { label: 'Segurança', cor: '#c084fc' },
  mural: { label: 'Mural', cor: '#FF9200' },
  eventos: { label: 'Eventos', cor: '#60a5fa' },
  presenca: { label: 'Presença', cor: '#4ade80' },
  justificativas: { label: 'Justificativas', cor: '#fde047' },
  graduacao: { label: 'Graduação', cor: '#f472b6' },
  responsaveis: { label: 'Responsáveis', cor: '#2dd4bf' },
  sistema: { label: 'Sistema', cor: '#a3a3a3' },
};

const CATEGORIAS_CONFIG: Array<{ key: string; label: string; desc: string; col: keyof NonNullable<Preferencias> }> = [
  { key: 'mural', label: 'Mural e avisos', desc: 'Publicações e comunicados dos núcleos', col: 'mural_enabled' },
  { key: 'eventos', label: 'Eventos', desc: 'Batizados, trocas de graduação e encontros', col: 'events_enabled' },
  { key: 'presenca', label: 'Presença e frequência', desc: 'Registros e alertas de frequência', col: 'attendance_enabled' },
  { key: 'justificativas', label: 'Justificativas', desc: 'Envio, aprovação e recusa de faltas justificadas', col: 'justification_enabled' },
  { key: 'graduacao', label: 'Graduação', desc: 'Graduações registradas e avaliações', col: 'graduation_enabled' },
  { key: 'responsaveis', label: 'Responsáveis e dependentes', desc: 'Vínculos, autorizações e novidades dos dependentes', col: 'guardian_enabled' },
  { key: 'sistema', label: 'Sistema', desc: 'Manutenções e novidades da plataforma', col: 'system_enabled' },
];

/** Histórico de novidades (changelog) como o aluno vê — reutiliza o modal do rodapé. */
const ORDEM_CATEGORIAS_NOVIDADES: ChangelogCategoria[] = ['novo', 'melhorias', 'interface', 'correcoes', 'seguranca', 'desempenho'];
const NOVIDADES_SEEN_KEY = 'pa_changelog_visto';

function dataBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function NovidadesView() {
  const entradas = changelogParaAluno();
  useEffect(() => {
    try { localStorage.setItem(NOVIDADES_SEEN_KEY, versaoReferenciaAluno()); window.dispatchEvent(new Event('pa-changelog-visto')); } catch {}
  }, []);
  if (entradas.length === 0) {
    return <div style={{ color: '#8f8f8f', fontSize: '0.82rem', textAlign: 'center', padding: 24 }}>Nenhuma novidade publicada ainda.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: '2px 4px 0', fontSize: '0.78rem', color: '#a3a3a3', lineHeight: 1.5 }}>
        O que mudou de verdade no seu app — recursos novos, correções e segurança.
      </p>
      {entradas.map((entry, ei) => {
        const grupos = ORDEM_CATEGORIAS_NOVIDADES
          .map(cat => ({ cat, itens: entry.itens.filter(i => i.categoria === cat) }))
          .filter(g => g.itens.length > 0);
        return (
          <div key={entry.versao} style={{ background: 'rgba(255,255,255,0.035)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.86rem', fontWeight: 800, color: ei === 0 ? '#FF9200' : '#f5f5f4' }}>v{entry.versao}</span>
              <span style={{ fontSize: '0.72rem', color: '#8f8f8f' }}>{dataBR(entry.data)}</span>
              {ei === 0 && (
                <span style={{ fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#4ade80', background: 'rgba(74,222,128,0.10)', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 999, padding: '2px 8px' }}>Atual</span>
              )}
            </div>
            <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f5f5f4', margin: '6px 0 4px' }}>{entry.titulo}</div>
            <p style={{ margin: 0, fontSize: '0.79rem', lineHeight: 1.5, color: '#b3b3b3' }}>{entry.descricao}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 10 }}>
              {grupos.map(({ cat, itens }) => {
                const meta = CHANGELOG_META[cat];
                return (
                  <div key={cat}>
                    <span style={{ display: 'inline-block', fontSize: '0.62rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', color: meta.cor, background: meta.bg, border: `1px solid ${meta.border}`, borderRadius: 999, padding: '2px 9px', marginBottom: 5 }}>
                      {meta.label}
                    </span>
                    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {itens.map((item, ii) => (
                        <li key={ii} style={{ display: 'flex', gap: 8, fontSize: '0.78rem', lineHeight: 1.5, color: '#cfcfcf' }}>
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
  );
}

function quando(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Estado do push em texto amigável. */
function rotuloEstado(s: PushState): { texto: string; cor: string } {
  switch (s) {
    case 'ativo': return { texto: 'Notificações ativas neste dispositivo', cor: '#4ade80' };
    case 'pendente': return { texto: 'Notificações desativadas', cor: '#a3a3a3' };
    case 'negado': return { texto: 'Permissão negada no navegador', cor: '#f87171' };
    case 'ios_instalar': return { texto: 'No iPhone, adicione o app à Tela de Início primeiro', cor: '#fde047' };
    case 'sem_suporte': return { texto: 'Este navegador não suporta push', cor: '#a3a3a3' };
    default: return { texto: 'Verificando…', cor: '#a3a3a3' };
  }
}

export default function NotificationsCenter({
  authenticated,
  modo = 'aluno',
  onNavigate,
}: {
  authenticated: boolean;
  modo?: 'aluno' | 'painel';
  onNavigate?: (destino: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'lista' | 'config' | 'novidades'>('lista');
  const [items, setItems] = useState<NotificacaoItem[]>([]);
  const [prefs, setPrefs] = useState<Preferencias>(null);
  const [dispositivos, setDispositivos] = useState<DispositivoItem[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [msg, setMsg] = useState('');
  const [montado, setMontado] = useState(false);
  const [temNovidade, setTemNovidade] = useState(false);
  const push = usePush(authenticated);

  // Ponto laranja no sino enquanto houver novidade não vista (mesma regra do botão da capa).
  const sincronizarNovidade = useCallback(() => {
    try {
      const visto = localStorage.getItem(NOVIDADES_SEEN_KEY) || '';
      setTemNovidade(!!visto && visto !== versaoReferenciaAluno());
    } catch { setTemNovidade(false); }
  }, []);

  useEffect(() => {
    sincronizarNovidade();
    window.addEventListener('pa-changelog-visto', sincronizarNovidade);
    window.addEventListener('storage', sincronizarNovidade);
    return () => {
      window.removeEventListener('pa-changelog-visto', sincronizarNovidade);
      window.removeEventListener('storage', sincronizarNovidade);
    };
  }, [sincronizarNovidade]);

  // O painel precisa de portal: dentro do header com backdrop-filter ele fica
  // preso no contexto de empilhamento do cabeçalho (altura do header apenas).
  useEffect(() => setMontado(true), []);

  // Esc fecha o painel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const carregar = useCallback(async () => {
    if (!authenticated) return;
    setCarregando(true);
    try {
      const res = await fetch('/api/notificacoes/central', { cache: 'no-store' });
      if (!res.ok) return;
      const d = await res.json();
      setItems(d.items || []);
      setPrefs(d.preferencias || null);
      setDispositivos(d.dispositivos || []);
      setNaoLidas(d.nao_lidas || 0);
    } finally {
      setCarregando(false);
    }
  }, [authenticated]);

  // Contador leve: recarrega ao abrir a painel e a cada foco da janela
  useEffect(() => {
    if (!authenticated) return;
    carregar();
    const onFocus = () => carregar();
    window.addEventListener('focus', onFocus);
    const iv = setInterval(carregar, 120000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(iv); };
  }, [authenticated, carregar]);

  const marcarLida = async (id: string) => {
    setItems(prev => prev.map(n => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    setNaoLidas(c => Math.max(0, c - 1));
    await fetch('/api/notificacoes/central', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ler', id }),
    }).catch(() => {});
  };

  const marcarTodas = async () => {
    setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
    setNaoLidas(0);
    await fetch('/api/notificacoes/central', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ler-todas' }),
    }).catch(() => {});
  };

  const abrir = (n: NotificacaoItem) => {
    if (!n.read_at) marcarLida(n.id);
    setOpen(false);
    onNavigate?.(abaDe(n.target_type));
  };

  const salvarPref = async (col: string, valor: boolean) => {
    if (!prefs) return;
    const novas = { ...prefs, [col]: valor };
    setPrefs(novas);
    await fetch('/api/notificacoes/central', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'preferencias', preferencias: {
        mural: novas.mural_enabled, eventos: novas.events_enabled, presenca: novas.attendance_enabled,
        justificativas: novas.justification_enabled, graduacao: novas.graduation_enabled,
        responsaveis: novas.guardian_enabled, sistema: novas.system_enabled,
      } }),
    }).catch(() => {});
  };

  const testar = async () => {
    setMsg('');
    const res = await fetch('/api/notificacoes/central', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'teste' }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.pushesOk > 0) setMsg('Notificação de teste enviada — confira seu dispositivo.');
    else if (d.pushesFalha > 0) setMsg('Dispositivo registrado, mas o envio falhou. Verifique a conexão e tente de novo.');
    else setMsg('Nenhum dispositivo ativo para receber. Ative as notificações primeiro.');
    carregar();
  };

  const revogarDispositivo = async (id: string) => {
    await fetch('/api/notificacoes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unsubscribe', subscription_id: id }),
    }).catch(() => {});
    setDispositivos(prev => prev.map(d => (d.id === id ? { ...d, active: false } : d)));
  };

  if (!authenticated) return null;
  const estado = rotuloEstado(push.state === 'ios_instalar' ? 'ios_instalar' : push.state);

  return (
    <>
      {/* Sino no header */}
      <button
        onClick={() => setOpen(true)}
        aria-label={`Notificações${naoLidas > 0 ? ` — ${naoLidas} não lidas` : ''}`}
        className="press"
        style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42, borderRadius: 13, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: '#e5e5e5', cursor: 'pointer' }}
      >
        <IconBell size={20} />
        {naoLidas > 0 && (
          <span style={{ position: 'absolute', top: 6, right: 6, minWidth: 17, height: 17, borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: '0.62rem', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxShadow: '0 0 10px rgba(239,68,68,0.6)', border: '1.5px solid rgba(10,10,12,0.9)' }}>
            {naoLidas > 9 ? '9+' : naoLidas}
          </span>
        )}
      </button>

      {/* Painel lateral — portal no document.body para não herdar o contexto do header */}
      {open && montado && createPortal(
        <div
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
          role="dialog" aria-modal="true" aria-label="Notificações"
          style={{ position: 'fixed', inset: 0, zIndex: 110, background: 'rgba(4,4,6,0.6)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', display: 'flex', justifyContent: 'flex-end' }}
        >
          <aside
            onClick={e => e.stopPropagation()}
            style={{
              width: 'min(420px, 100vw)', height: '100%', display: 'flex', flexDirection: 'column',
              background: 'linear-gradient(165deg, rgba(24,24,27,0.97) 0%, rgba(10,10,12,0.98) 100%)',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              animation: 'notifIn 0.22s cubic-bezier(0.22,1,0.36,1)',
              boxShadow: '-18px 0 60px rgba(0,0,0,0.6)',
            }}
          >
            <style>{`@keyframes notifIn { from { transform: translateX(28px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>

            {/* Cabeçalho */}
            <div style={{ padding: '14px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.30), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.32)', color: '#FF9200' }}>
                <IconBell size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#f5f5f4' }}>Notificações</div>
                {view === 'lista' && naoLidas > 0 && (
                  <button onClick={marcarTodas} style={{ border: 'none', background: 'none', padding: 0, color: '#FF9200', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}>
                    Marcar todas como lidas ({naoLidas})
                  </button>
                )}
                {view === 'novidades' && (
                  <span style={{ fontSize: '0.72rem', color: '#8f8f8f' }}>Histórico de atualizações</span>
                )}
              </div>
              {view === 'lista' && (
                <button
                  onClick={() => { setView('novidades'); sincronizarNovidade(); }}
                  className="press"
                  aria-label="Novidades — histórico de atualizações"
                  title="Novidades"
                  style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 5, padding: '7px 12px', borderRadius: 999, border: '1px solid rgba(255,146,0,0.4)', background: 'rgba(255,146,0,0.10)', color: '#FF9200', fontWeight: 700, fontSize: '0.74rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  ✦ Novidades
                  {temNovidade && (
                    <span aria-label="Nova versão disponível" style={{ position: 'absolute', top: -3, right: -1, width: 10, height: 10, borderRadius: '50%', background: '#FF9200', boxShadow: '0 0 8px rgba(255,146,0,0.8)' }} />
                  )}
                </button>
              )}
              <button onClick={() => (view === 'config' ? setView('lista') : setView('config'))} aria-label={view === 'config' ? 'Voltar às notificações' : 'Configurar notificações'} className="press"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: '#d4d4d4', cursor: 'pointer' }}>
                {view === 'config' ? <IconChevronLeft /> : <IconGear size={16} />}
              </button>
              <button onClick={() => setOpen(false)} aria-label="Fechar" className="press"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.05)', color: '#d4d4d4', cursor: 'pointer' }}>
                <IconX size={16} />
              </button>
            </div>

            {/* Conteúdo */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {view === 'lista' && (
                <>
                  {carregando && items.length === 0 && <div style={{ color: '#8f8f8f', fontSize: '0.82rem', textAlign: 'center', padding: 20 }}>Carregando…</div>}
                  {!carregando && items.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '36px 18px', color: '#8f8f8f' }}>
                      <span style={{ display: 'inline-flex', marginBottom: 10, color: '#525252' }}><IconBell size={30} /></span>
                      <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#d4d4d4' }}>Nenhuma notificação ainda</div>
                      <div style={{ fontSize: '0.78rem', marginTop: 4 }}>Avisos do mural, eventos e atualizações aparecem aqui.</div>
                    </div>
                  )}
                  {items.map(n => {
                    const meta = CAT_META[n.category] || CAT_META.sistema;
                    return (
                      <button key={n.id} onClick={() => abrir(n)} className="press"
                        style={{ textAlign: 'left', display: 'flex', gap: 10, padding: '11px 12px', borderRadius: 13, border: n.read_at ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(255,146,0,0.35)', background: n.read_at ? 'rgba(255,255,255,0.03)' : 'rgba(255,146,0,0.07)', cursor: 'pointer', width: '100%' }}>
                        <span style={{ flexShrink: 0, marginTop: 2, width: 9, height: 9, borderRadius: '50%', background: n.read_at ? 'transparent' : '#FF9200', border: n.read_at ? `1.5px solid ${meta.cor}55` : 'none' }} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: meta.cor }}>{meta.label}</span>
                            <span style={{ fontSize: '0.64rem', color: '#737373' }}>{quando(n.created_at)}</span>
                          </span>
                          <span style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: '#f5f5f4', lineHeight: 1.3 }}>{n.title}</span>
                          {n.message && <span style={{ display: 'block', fontSize: '0.76rem', color: '#a3a3a3', lineHeight: 1.45, marginTop: 2 }}>{n.message}</span>}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}

              {view === 'novidades' && <NovidadesView />}

              {view === 'config' && (
                <>
                  {/* Push neste dispositivo */}
                  <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '13px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: estado.cor, boxShadow: `0 0 8px ${estado.cor}88` }} />
                      <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f5f5f4' }}>{estado.texto}</span>
                    </div>
                    <p style={{ margin: '0 0 10px', fontSize: '0.76rem', color: '#a3a3a3', lineHeight: 1.5 }}>
                      Receba avisos importantes, comunicados do mural, eventos e outras atualizações diretamente no seu dispositivo — mesmo com o app fechado.
                    </p>
                    {push.state === 'ativo' && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={testar} disabled={push.busy} className="press" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 10, border: '1px solid rgba(255,146,0,0.4)', background: 'rgba(255,146,0,0.10)', color: '#FF9200', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>
                          <IconBell size={14} /> Enviar notificação de teste
                        </button>
                        <button onClick={push.desativar} disabled={push.busy} className="press" style={{ padding: '8px 13px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.05)', color: '#d4d4d4', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer' }}>
                          Desativar neste dispositivo
                        </button>
                      </div>
                    )}
                    {(push.state === 'pendente' || push.state === 'servidor_off') && (
                      <button onClick={() => push.ativar().then(r => { if (!r.ok && r.erro) setMsg(r.erro); })} disabled={push.busy} className="press"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 15px', borderRadius: 10, border: '1px solid rgba(255,146,0,0.5)', background: 'linear-gradient(135deg, #ffb84d 0%, #FF9200 100%)', color: '#18181b', fontWeight: 800, fontSize: '0.82rem', cursor: 'pointer' }}>
                        <IconBell size={15} /> Ativar notificações
                      </button>
                    )}
                    {push.state === 'negado' && (
                      <p style={{ margin: 0, fontSize: '0.74rem', color: '#f87171', lineHeight: 1.5 }}>
                        A permissão foi bloqueada nas configurações do navegador. Libere as notificações para este site nas configurações do próprio navegador e volte aqui.
                      </p>
                    )}
                    {push.state === 'ios_instalar' && (
                      <p style={{ margin: 0, fontSize: '0.74rem', color: '#fde047', lineHeight: 1.5 }}>
                        No iPhone/iPad, o push funciona com o app instalado: toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>, abra o app por lá e ative as notificações.
                      </p>
                    )}
                    {push.state === 'sem_suporte' && (
                      <p style={{ margin: 0, fontSize: '0.74rem', color: '#a3a3a3' }}>
                        Este navegador não suporta push. As notificações internas continuam funcionando normalmente.
                      </p>
                    )}
                    {msg && <p style={{ margin: '8px 0 0', fontSize: '0.75rem', color: '#fdba74' }}>{msg}</p>}
                  </section>

                  {/* Preferências por categoria */}
                  <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '13px 14px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>O que você quer receber</div>

                    {/* Obrigatória */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 10px', borderRadius: 11, background: 'rgba(192,132,252,0.06)', border: '1px solid rgba(192,132,252,0.25)', marginBottom: 8 }}>
                      <span style={{ color: '#c084fc', marginTop: 1 }}><IconLock /></span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f5f5f4' }}>Conta e segurança</div>
                        <div style={{ fontSize: '0.72rem', color: '#a3a3a3', lineHeight: 1.45 }}>Login, senha, recuperação e vínculos — sempre ativas</div>
                      </div>
                      <span style={{ fontSize: '0.62rem', fontWeight: 800, color: '#c084fc', whiteSpace: 'nowrap', marginTop: 3 }}>🔒 Sempre ativas</span>
                    </div>

                    {CATEGORIAS_CONFIG.map(c => {
                      const ligada = prefs ? Boolean(prefs[c.col]) : true;
                      return (
                        <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 6 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f5f5f4' }}>{c.label}</div>
                            <div style={{ fontSize: '0.7rem', color: '#8f8f8f', lineHeight: 1.4 }}>{c.desc}</div>
                          </div>
                          <button
                            role="switch" aria-checked={ligada} aria-label={`${c.label}: ${ligada ? 'ligado' : 'desligado'}`}
                            onClick={() => salvarPref(c.col, !ligada)}
                            className="press"
                            style={{ flexShrink: 0, width: 44, height: 25, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative', background: ligada ? 'linear-gradient(135deg, #ffb84d, #FF9200)' : 'rgba(255,255,255,0.12)', transition: 'background 0.15s' }}
                          >
                            <span style={{ position: 'absolute', top: 3, left: ligada ? 22 : 3, width: 19, height: 19, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.4)', transition: 'left 0.15s' }} />
                          </button>
                        </div>
                      );
                    })}
                  </section>

                  {/* Dispositivos */}
                  <section style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '13px 14px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Dispositivos</div>
                    {dispositivos.length === 0 && <div style={{ fontSize: '0.78rem', color: '#8f8f8f' }}>Nenhum dispositivo com push registrado.</div>}
                    {dispositivos.map(d => (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 11, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 6, opacity: d.active ? 1 : 0.5 }}>
                        <span style={{ color: d.active ? '#4ade80' : '#737373', flexShrink: 0 }}><IconDevice /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f5f5f4' }}>{d.device_name}</div>
                          <div style={{ fontSize: '0.68rem', color: '#8f8f8f' }}>
                            {d.active ? `Ativo · visto ${quando(d.last_seen_at)}` : `Desativado · visto ${quando(d.last_seen_at)}`}
                          </div>
                        </div>
                        {d.active && (
                          <button onClick={() => revogarDispositivo(d.id)} aria-label={`Desativar ${d.device_name}`} className="press"
                            style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, borderRadius: 9, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#f87171', cursor: 'pointer' }}>
                            <IconTrash size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                </>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

function abaDe(targetType: string): string {
  switch (targetType) {
    case 'mural': return 'dashboard';
    case 'evento': return 'graduacao';
    case 'justificativa': return 'justificativas';
    case 'graduacao': return 'graduacao';
    case 'presenca': return 'presenca';
    case 'vinculo': return 'conta';
    default: return 'dashboard';
  }
}

/* Ícones de traço locais (mesmo vocabulário visual do app) */
function IconChevronLeft() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>;
}
function IconLock() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>;
}
function IconDevice() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M12 18h.01" /></svg>;
}
