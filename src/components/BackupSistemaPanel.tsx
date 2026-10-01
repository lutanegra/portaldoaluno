'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconRefresh, IconTrash, IconDownload, IconGear, IconWarn, IconCheck, IconClock } from '@/components/icons';

/**
 * Painel "Configurações → Backup" (Owner/Admin Geral).
 * - Configuração do automático (ativar, frequência, horário, retenção).
 * - "Fazer backup agora" com progresso por etapas.
 * - Histórico com tipo, data, tamanho, status, duração + baixar/restaurar/excluir.
 * - Restauração exige digitar RESTAURAR; antes dela o servidor cria uma cópia
 *   de segurança do estado atual automaticamente.
 */

type BackupTipo = 'automatico' | 'manual' | 'pre_operacao' | 'pre_restauracao';

type BackupItem = {
  filename: string;
  created_at: string;
  tipo: BackupTipo;
  gatilho: string;
  status: 'concluido' | 'falhou';
  erro?: string;
  size_bytes: number;
  duracao_ms: number;
  contagens: Record<string, number>;
  por: string;
};

type Settings = {
  automatico: boolean;
  frequencia: '6h' | 'diario' | '3dias' | 'semanal';
  horario: string;
  manter: number;
  manter_dias: number | null;
  atualizado_em: string;
  atualizado_por: string;
};

type Status = {
  settings: Settings;
  items: BackupItem[];
  ultimo: BackupItem | null;
  ultimoAutomatico: BackupItem | null;
  proximo: number | null;
};

const TIPO_LABEL: Record<BackupTipo, string> = {
  automatico: 'Automático',
  manual: 'Manual',
  pre_operacao: 'Pré-operação',
  pre_restauracao: 'Pré-restauração',
};

function fmtBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtData(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtDuracao(ms: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function resumoContagens(c: Record<string, number> | undefined): string {
  if (!c) return '';
  const partes: string[] = [];
  if (c.students !== undefined) partes.push(`${c.students} alunos`);
  if (c.presencas !== undefined) partes.push(`${c.presencas} presenças`);
  if (c.checkins !== undefined) partes.push(`${c.checkins} check-ins`);
  if (c.nucleos !== undefined) partes.push(`${c.nucleos} núcleos`);
  if (c.arquivos !== undefined) partes.push(`${c.arquivos} arquivos`);
  return partes.join(' · ');
}

const labelStyle: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.85rem' };

export default function BackupSistemaPanel({ isOwner }: { isOwner: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [salvandoCfg, setSalvandoCfg] = useState(false);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [restaurarAlvo, setRestaurarAlvo] = useState<BackupItem | null>(null);
  const [confirmacaoTxt, setConfirmacaoTxt] = useState('');
  const [excluirAlvo, setExcluirAlvo] = useState<BackupItem | null>(null);
  const [confirmacaoDel, setConfirmacaoDel] = useState('');
  const timersRef = useRef<number[]>([]);

  useEffect(() => () => { timersRef.current.forEach(t => window.clearTimeout(t)); }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/backup', { cache: 'no-store' });
      const d = await res.json();
      if (res.ok && d.ok) {
        setStatus(d as Status);
        setForm(d.settings);
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Falha ao carregar o backup.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão ao carregar o backup.' });
    }
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const depois = (ms: number, fn: () => void) => { timersRef.current.push(window.setTimeout(fn, ms)); };

  const gerarAgora = () => {
    if (etapa) return;
    setMsg(null);
    setEtapa('Preparando backup…');
    depois(500, () => {
      setEtapa('Gerando backup — coletando banco e configurações…');
      fetch('/api/admin/backup', { method: 'POST' })
        .then(async res => {
          const d = await res.json();
          setEtapa('Salvando backup…');
          depois(400, () => {
            setEtapa(null);
            if (res.ok && d.ok) {
              setMsg({ tipo: 'ok', texto: `Backup concluído: ${resumoContagens(d.item.contagens)} — ${fmtBytes(d.item.size_bytes)} em ${fmtDuracao(d.item.duracao_ms)}.` });
              carregar();
            } else {
              setMsg({ tipo: 'erro', texto: d.error || 'Falha ao gerar o backup.' });
            }
          });
        })
        .catch(() => { setEtapa(null); setMsg({ tipo: 'erro', texto: 'Erro de conexão ao gerar o backup.' }); });
    });
  };

  const salvarCfg = async () => {
    if (!form) return;
    setSalvandoCfg(true);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/backup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automatico: form.automatico,
          frequencia: form.frequencia,
          horario: form.horario,
          manter: form.manter,
          manter_dias: form.manter_dias,
        }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setForm(d.settings);
        setMsg({ tipo: 'ok', texto: 'Configurações do backup salvas.' });
        carregar();
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Falha ao salvar as configurações.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão ao salvar as configurações.' });
    }
    setSalvandoCfg(false);
  };

  const abrirRestaurar = (item: BackupItem) => { setRestaurarAlvo(item); setConfirmacaoTxt(''); };
  const confirmarRestaurar = async () => {
    if (!restaurarAlvo || confirmacaoTxt.trim().toUpperCase() !== 'RESTAURAR') return;
    setBusyItem(restaurarAlvo.filename);
    setMsg(null);
    try {
      const res = await fetch('/api/admin/backup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: restaurarAlvo.filename, confirmacao: confirmacaoTxt }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        const r = d.resultado;
        setMsg({
          tipo: 'ok',
          texto: `Estado restaurado da cópia de ${fmtData(restaurarAlvo.created_at)}: ` +
            `${r.restaurados?.students ?? 0} alunos, ${r.restaurados?.presencas ?? 0} presenças, ${r.restaurados?.checkins ?? 0} check-ins e ${r.arquivos} arquivos de configuração. ` +
            `Removidos desde então: ${r.removidos?.students ?? 0} alunos, ${r.removidos?.presencas ?? 0} presenças. Uma cópia do estado anterior foi salva antes.`,
        });
        setRestaurarAlvo(null);
        carregar();
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Falha na restauração.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão na restauração.' });
    }
    setBusyItem(null);
  };

  const baixar = async (item: BackupItem) => {
    setBusyItem(item.filename);
    try {
      const res = await fetch(`/api/admin/backup/download?filename=${encodeURIComponent(item.filename)}`);
      const d = await res.json();
      if (res.ok && d.ok) {
        window.open(d.url, '_blank');
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Falha ao gerar o download.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão ao gerar o download.' });
    }
    setBusyItem(null);
  };

  const abrirExcluir = (item: BackupItem) => { setExcluirAlvo(item); setConfirmacaoDel(''); };
  const confirmarExcluir = async () => {
    if (!excluirAlvo || confirmacaoDel.trim().toUpperCase() !== 'APAGAR') return;
    setBusyItem(excluirAlvo.filename);
    try {
      const res = await fetch('/api/admin/backup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: excluirAlvo.filename }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setMsg({ tipo: 'ok', texto: 'Cópia removida do histórico.' });
        setExcluirAlvo(null);
        carregar();
      } else {
        setMsg({ tipo: 'erro', texto: d.error || 'Falha ao remover a cópia.' });
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Erro de conexão ao remover a cópia.' });
    }
    setBusyItem(null);
  };

  const s = form;
  const cfgSuja = status && s && (
    s.automatico !== status.settings.automatico ||
    s.frequencia !== status.settings.frequencia ||
    s.horario !== status.settings.horario ||
    s.manter !== status.settings.manter ||
    (s.manter_dias ?? null) !== (status.settings.manter_dias ?? null)
  );

  const proximoTxt = (() => {
    if (!status?.settings.automatico) return 'Backup automático desativado';
    if (!status.proximo || !Number.isFinite(status.proximo)) return 'Na próxima verificação';
    return new Date(status.proximo).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Status geral ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FF9200' }}>
            <IconGear size={19} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Backup Completo do Sistema</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Alunos, presenças, check-ins, chamadas, justificativas, mural, contas e configurações — em uma única cópia compactada.
            </div>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '14px 0' }}>Carregando status…</div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, margin: '16px 0' }}>
              <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Último backup</div>
                {status?.ultimo ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{fmtData(status.ultimo.created_at)}</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>{TIPO_LABEL[status.ultimo.tipo]} · {fmtBytes(status.ultimo.size_bytes)}</div>
                  </>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: 600 }}>Nenhuma cópia ainda</div>
                )}
              </div>
              <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Próximo automático</div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <IconClock size={14} /> {proximoTxt}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                  {status?.settings.automatico ? `Frequência: ${status.settings.frequencia === '6h' ? 'a cada 6 horas' : status.settings.frequencia === 'diario' ? `diário às ${status.settings.horario}` : status.settings.frequencia === '3dias' ? 'a cada 3 dias' : 'semanal'} (Brasília)` : 'Ative abaixo'}
                </div>
              </div>
              <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 4 }}>Status</div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem', color: status?.settings.automatico ? '#86efac' : '#fbbf24', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: status?.settings.automatico ? '#22c55e' : '#f59e0b', boxShadow: `0 0 8px ${status?.settings.automatico ? '#22c55e88' : '#f59e0b88'}` }} />
                  {status?.settings.automatico ? 'Backup automático ativo' : 'Automático desativado'}
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>{status?.items.filter(i => i.status === 'concluido').length ?? 0} cópia(s) no histórico</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={gerarAgora} disabled={!!etapa}
                style={{ background: 'linear-gradient(135deg,#FFA733,#FF9200)', color: '#0a0a0a', border: 'none', borderRadius: 9, padding: '9px 18px', fontWeight: 800, fontSize: '0.84rem', cursor: etapa ? 'wait' : 'pointer', opacity: etapa ? 0.75 : 1 }}>
                {etapa ? etapa : 'Fazer backup agora'}
              </button>
              <button onClick={() => setMostrarConfig(v => !v)} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 9, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <IconGear size={14} /> Configurações {mostrarConfig ? '▲' : '▼'}
              </button>
              {isOwner && (
                <a href="/backup-cron" target="_blank" rel="noreferrer" style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: '#FF9200', borderRadius: 9, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  Agendamento 24/7
                </a>
              )}
            </div>

            {etapa && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600, background: 'rgba(255,146,0,0.10)', border: '1px solid rgba(255,146,0,0.35)', color: '#fdba74', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="pa-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(255,146,0,0.3)', borderTopColor: '#FF9200', display: 'inline-block', animation: 'paSpin 0.8s linear infinite' }} />
                {etapa}
              </div>
            )}

            {msg && (
              <div style={{
                marginTop: 12, padding: '10px 14px', borderRadius: 10, fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.5,
                background: msg.tipo === 'ok' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
                border: `1px solid ${msg.tipo === 'ok' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                color: msg.tipo === 'ok' ? '#86efac' : '#fca5a5', display: 'flex', gap: 8, alignItems: 'flex-start',
              }}>
                {msg.tipo === 'ok' ? <IconCheck size={15} /> : <IconWarn size={15} />} <span>{msg.texto}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Configurações ── */}
      {mostrarConfig && s && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: 14 }}>Configurações → Backup</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>Backup automático</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Executa no servidor, no fuso de Brasília</div>
            </div>
            <button onClick={() => setForm({ ...s, automatico: !s.automatico })} aria-pressed={s.automatico}
              style={{ width: 46, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', position: 'relative', background: s.automatico ? 'linear-gradient(135deg,#FFA733,#FF9200)' : '#3a3a3a', transition: 'background 0.2s' }}>
              <span style={{ position: 'absolute', top: 3, left: s.automatico ? 23 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <div>
              <label style={labelStyle}>Frequência</label>
              <select value={s.frequencia} onChange={e => setForm({ ...s, frequencia: e.target.value as Settings['frequencia'] })} style={inputStyle} disabled={!s.automatico}>
                <option value="6h">A cada 6 horas</option>
                <option value="diario">Diário</option>
                <option value="3dias">A cada 3 dias</option>
                <option value="semanal">Semanal</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Horário (Brasília)</label>
              <input type="time" value={s.horario} onChange={e => setForm({ ...s, horario: e.target.value })} style={inputStyle} disabled={!s.automatico || s.frequencia !== 'diario'} />
            </div>
            <div>
              <label style={labelStyle}>Manter (quantidade)</label>
              <input type="number" min={3} max={500} value={s.manter} onChange={e => setForm({ ...s, manter: Number(e.target.value) })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Ou manter últimos (dias)</label>
              <input type="number" min={0} placeholder="— desativado —" value={s.manter_dias ?? ''} onChange={e => setForm({ ...s, manter_dias: e.target.value === '' ? null : Number(e.target.value) })} style={inputStyle} />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            {cfgSuja && <button onClick={carregar} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '0.8rem', cursor: 'pointer' }}>Desfazer</button>}
            <button onClick={salvarCfg} disabled={salvandoCfg || !cfgSuja}
              style={{ background: cfgSuja ? 'linear-gradient(135deg,#FFA733,#FF9200)' : 'var(--bg-input)', color: cfgSuja ? '#0a0a0a' : 'var(--text-tertiary)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 20px', fontWeight: 800, fontSize: '0.82rem', cursor: cfgSuja ? 'pointer' : 'default' }}>
              {salvandoCfg ? 'Salvando…' : 'Salvar configurações'}
            </button>
          </div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', marginTop: 10, lineHeight: 1.5 }}>
            A execução automática acontece no servidor. Mesmo sem agendador externo, o sistema se autorregula
            sempre que o painel é usado; com o agendador 24/7 ativo, a cópia sai pontualmente no horário
            mesmo com ninguém acessando (guia no botão laranja acima, exclusivo do Owner).
          </div>
        </div>
      )}

      {/* ── Histórico ── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary)' }}>Histórico de backups</div>
          <button onClick={carregar} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 9, padding: '7px 14px', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconRefresh size={13} /> Atualizar
          </button>
        </div>

        {!status || status.items.length === 0 ? (
          <div style={{ padding: '18px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
            Nenhuma cópia ainda — clique em "Fazer backup agora" para criar a primeira.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {status.items.map(item => {
              const falhou = item.status !== 'concluido';
              return (
                <div key={item.filename} style={{ background: 'var(--bg-input)', border: `1px solid ${falhou ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`, borderRadius: 12, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: falhou ? '#fca5a5' : 'var(--text-primary)' }}>{fmtData(item.created_at)}</span>
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', color: '#FF9200' }}>{TIPO_LABEL[item.tipo]}</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 600, color: falhou ? '#fca5a5' : '#86efac', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: falhou ? '#ef4444' : '#22c55e' }} />
                          {falhou ? 'Falhou' : 'Concluído'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                        {falhou ? (item.erro || 'Erro desconhecido') : `${fmtBytes(item.size_bytes)} · ${fmtDuracao(item.duracao_ms)} · ${resumoContagens(item.contagens)} · por ${item.por}`}
                      </div>
                    </div>
                    {!falhou && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <button onClick={() => baixar(item)} disabled={busyItem === item.filename} title="Baixar cópia"
                          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', display: 'inline-flex' }}>
                          <IconDownload size={15} />
                        </button>
                        <button onClick={() => abrirRestaurar(item)} disabled={!!busyItem} title="Restaurar esta cópia"
                          style={{ background: 'var(--bg-card)', border: '1px solid rgba(255,146,0,0.4)', color: '#FF9200', borderRadius: 8, padding: '6px 10px', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer' }}>
                          Restaurar
                        </button>
                        <button onClick={() => abrirExcluir(item)} disabled={!!busyItem} title="Excluir cópia"
                          style={{ background: 'var(--bg-card)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', display: 'inline-flex' }}>
                          <IconTrash size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modal restaurar ── */}
      {restaurarAlvo && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar restauração"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setRestaurarAlvo(null); }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, maxWidth: 460, width: '100%' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, color: '#fbbf24' }}>
              <IconWarn size={22} />
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Restaurar backup</div>
            </div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 12px' }}>
              Os dados atuais serão <strong style={{ color: 'var(--text-primary)' }}>substituídos</strong> pelo conteúdo desta cópia
              (alunos, presenças, check-ins, chamadas, justificativas, mural, contas e configurações).
              Antes de restaurar, o sistema salva automaticamente uma cópia do estado atual — dá para voltar atrás.
            </p>
            <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: 12 }}>
              Cópia de {fmtData(restaurarAlvo.created_at)} · {TIPO_LABEL[restaurarAlvo.tipo]} · {resumoContagens(restaurarAlvo.contagens)}
            </div>
            <label style={labelStyle}>Digite <strong>RESTAURAR</strong> para confirmar</label>
            <input value={confirmacaoTxt} onChange={e => setConfirmacaoTxt(e.target.value)} placeholder="RESTAURAR" style={inputStyle} autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setRestaurarAlvo(null)} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 9, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={confirmarRestaurar} disabled={confirmacaoTxt.trim().toUpperCase() !== 'RESTAURAR' || !!busyItem}
                style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontWeight: 800, fontSize: '0.82rem', cursor: confirmacaoTxt.trim().toUpperCase() === 'RESTAURAR' ? 'pointer' : 'not-allowed', opacity: confirmacaoTxt.trim().toUpperCase() === 'RESTAURAR' ? 1 : 0.5 }}>
                {busyItem ? 'Restaurando…' : 'Restaurar agora'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal excluir ── */}
      {excluirAlvo && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar exclusão da cópia"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={e => { if (e.target === e.currentTarget) setExcluirAlvo(null); }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, maxWidth: 440, width: '100%' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, color: '#f87171' }}>
              <IconTrash size={20} />
              <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text-primary)' }}>Excluir cópia de backup</div>
            </div>
            <p style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 12px' }}>
              A cópia de {fmtData(excluirAlvo.created_at)} ({fmtBytes(excluirAlvo.size_bytes)}) será apagada do histórico.
            </p>
            <label style={labelStyle}>Digite <strong>APAGAR</strong> para confirmar</label>
            <input value={confirmacaoDel} onChange={e => setConfirmacaoDel(e.target.value)} placeholder="APAGAR" style={inputStyle} autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setExcluirAlvo(null)} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 9, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>Cancelar</button>
              <button onClick={confirmarExcluir} disabled={confirmacaoDel.trim().toUpperCase() !== 'APAGAR' || !!busyItem}
                style={{ background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', border: 'none', borderRadius: 9, padding: '9px 18px', fontWeight: 800, fontSize: '0.82rem', cursor: confirmacaoDel.trim().toUpperCase() === 'APAGAR' ? 'pointer' : 'not-allowed', opacity: confirmacaoDel.trim().toUpperCase() === 'APAGAR' ? 1 : 0.5 }}>
                {busyItem ? 'Removendo…' : 'Apagar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
