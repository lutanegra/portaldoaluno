'use client';

/**
 * FrequenciaCard — gráfico de frequência individual do aluno na tela inicial.
 * Barras verticais dos últimos 8 meses (do próprio app do aluno) + últimos 28 dias
 * em grade semanal. Dados de /api/aluno/evolucao (mesma fonte da aba Evolução).
 */
import { useEffect, useMemo, useState } from 'react';
import { IconTrend, IconFlame, IconStar } from '@/components/icons';

type Mes = { key: string; label: string; count: number };
type Semana = { date: string; day: number; active: boolean }[];

type Props = {
  studentId: string;
  cordaColors: string[];
  graduacao?: string;
};

export default function FrequenciaCard({ studentId, cordaColors, graduacao }: Props) {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    let alive = true;
    setLoading(true);
    fetch(`/api/aluno/evolucao?student_id=${studentId}`)
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        setDates(Array.isArray(d.dates) ? d.dates : []);
        setLoading(false);
      })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId]);

  // ── Cálculos ────────────────────────────────────────────────────────────────
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dateSet = useMemo(() => new Set(dates), [dates]);

  const months = useMemo<Mes[]>(() => {
    const byMonth: Record<string, number> = {};
    for (const d of dates) {
      const ym = d.slice(0, 7);
      byMonth[ym] = (byMonth[ym] || 0) + 1;
    }
    const out: { key: string; label: string; count: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push({
        key,
        label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
        count: byMonth[key] || 0,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates]);

  const maxCount = Math.max(...months.map(m => m.count), 1);

  // Últimos 28 dias em grade de 4 semanas (colunas = semanas, linhas = dias)
  const weeks = useMemo<Semana[]>(() => {
    const out: { date: string; day: number; active: boolean }[][] = [];
    let cur: { date: string; day: number; active: boolean }[] = [];
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const s = d.toISOString().split('T')[0];
      cur.push({ date: s, day: d.getDate(), active: dateSet.has(s) });
      if (cur.length === 7) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateSet]);

  const thisMonth = months[months.length - 1]?.count || 0;
  const prevMonth = months[months.length - 2]?.count || 0;
  const delta = thisMonth - prevMonth;
  const diasDesdeUltimo = (() => {
    if (dates.length === 0) return null;
    const sorted = [...dates].sort();
    const last = new Date(sorted[sorted.length - 1] + 'T12:00:00');
    return Math.floor((now.getTime() - last.getTime()) / 86400000);
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'flex', color: '#FF9200' }}><IconTrend size={15} /></span>
        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: '#8f8f8f', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Minha Frequência</span>
        <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg, rgba(255,146,0,0.25), rgba(255,255,255,0.06))' }} />
      </div>

      <div className="glass" style={{ borderRadius: 18, padding: '16px 16px 14px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', color: '#8f8f8f', fontSize: '0.8rem', padding: '18px 0' }}>Carregando frequência...</div>
        ) : (
          <>
            {/* Resumo */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.30), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.32)', color: thisMonth >= 8 ? '#FF9200' : '#a3a3a3', flexShrink: 0, boxShadow: thisMonth >= 8 ? '0 0 16px rgba(255,146,0,0.22)' : 'none' }}>
                {thisMonth >= 8 ? <IconFlame size={20} /> : <IconTrend size={20} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#f5f5f4', lineHeight: 1.2 }}>
                  {thisMonth} treino{thisMonth === 1 ? '' : 's'} este mês
                </div>
                <div style={{ fontSize: '0.72rem', color: '#8f8f8f', marginTop: 1 }}>
                  {dates.length === 0
                    ? 'Nenhuma presença registrada ainda'
                    : diasDesdeUltimo === 0
                      ? 'Você treinou hoje — roda capoeira!'
                      : `Último treino há ${diasDesdeUltimo} dia${diasDesdeUltimo === 1 ? '' : 's'}`}
                </div>
              </div>
              {delta !== 0 && (
                <span style={{
                  flexShrink: 0, borderRadius: 8, padding: '3px 9px', fontSize: '0.72rem', fontWeight: 800,
                  background: delta > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
                  color: delta > 0 ? '#86efac' : '#fca5a5',
                }}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta)} vs. mês anterior
                </span>
              )}
            </div>

            {/* Barras por mês */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 96, marginBottom: 6 }}>
              {months.map(m => (
                <div key={m.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                  <span style={{ fontSize: '0.6rem', fontWeight: 800, color: m.count > 0 ? '#FF9200' : '#5a5a5a' }}>{m.count > 0 ? m.count : ''}</span>
                  <div style={{
                    width: '100%', maxWidth: 30, borderRadius: '6px 6px 3px 3px',
                    height: `${Math.max((m.count / maxCount) * 100, m.count > 0 ? 8 : 3)}%`,
                    background: m.count > 0
                      ? 'linear-gradient(180deg, #ffb84d 0%, #FF9200 45%, rgba(255,146,0,0.30) 100%)'
                      : 'rgba(255,255,255,0.07)',
                    transition: 'height 0.3s ease',
                  }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {months.map(m => (
                <div key={m.key} style={{ flex: 1, textAlign: 'center', fontSize: '0.58rem', fontWeight: 600, color: '#6b6b6b', textTransform: 'capitalize' }}>{m.label}</div>
              ))}
            </div>

            {/* Últimos 28 dias */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {weeks.map((week, wi) => (
                <div key={wi} style={{ display: 'flex', gap: 4 }}>
                  {week.map(day => (
                    <div key={day.date}
                      title={day.active ? `Presença em ${day.date.split('-').reverse().slice(0, 2).join('/')}` : undefined}
                      style={{
                        flex: 1, aspectRatio: '1', maxWidth: 26, borderRadius: '50%',
                        background: day.active ? '#FF9200' : 'rgba(255,255,255,0.08)',
                        boxShadow: day.active ? '0 0 10px rgba(255,146,0,0.5)' : 'none',
                      }} />
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: '0.62rem', color: '#6b6b6b' }}>Últimos 28 dias</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '0.62rem', color: '#6b6b6b' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF9200', boxShadow: '0 0 8px rgba(255,146,0,0.5)', display: 'inline-block' }} /> presente
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', display: 'inline-block', marginLeft: 6 }} /> sem registro
              </span>
            </div>

            {/* Rodapé com graduação */}
            {graduacao && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ display: 'inline-flex', height: 10, borderRadius: 5, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.45)', flexShrink: 0, minWidth: 26 }}>
                  {cordaColors.map((c: string, i: number) => (
                    <span key={i} style={{ flex: 1, background: c === '#FFFFFF' ? '#e5e7eb' : c }} />
                  ))}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#d4d4d4' }}>{graduacao}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, color: '#FF9200' }}>
                  <IconStar size={12} />
                  <span style={{ fontSize: '0.68rem', fontWeight: 700 }}>{dates.length} presenças no total</span>
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
