'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSystemConfig } from '@/hooks/useSystemConfig';

/**
 * RELATÓRIO QUANTITATIVO DE ALUNOS — aba Relatórios do painel.
 * Prestação de contas: totais geral/maior/menor sempre coerentes com o filtro
 * de núcleo, listagem com dados dos responsáveis dos menores e gráficos de
 * faixa etária. Impressão/PDF em A4 com cabeçalho oficial do grupo.
 */

type AlunoQuant = {
  id: string;
  nome: string;
  cpf: string;
  data_nascimento: string | null;
  idade: number | null;
  nucleo: string | null;
  menor: boolean;
  resp_nome: string;
  resp_cpf: string;
};

type QuantData = {
  total: number;
  maiores: number;
  menores: number;
  sem_data_nascimento: number;
  media_idade: number;
  faixas: Array<{ label: string; quantidade: number }>;
  por_nucleo: Array<{ nucleo: string; total: number; maiores: number; menores: number }>;
  alunos: AlunoQuant[];
};

const fmtCPF = (v: string): string => {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 11) return v || '—';
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

const fmtData = (dn: string | null): string => {
  if (!dn) return '—';
  const s = String(dn).slice(0, 10);
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
};

export default function QuantitativoPanel({
  nucleoFilter,
  dynamicNucleos,
}: {
  nucleoFilter: string | null;
  dynamicNucleos: Array<{ nome: string; slug: string }>;
}) {
  const { config } = useSystemConfig();
  const [nucleo, setNucleo] = useState(nucleoFilter || '');
  const [data, setData] = useState<QuantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);

  useEffect(() => { setNucleo(nucleoFilter || ''); }, [nucleoFilter]);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro('');
    fetch(`/api/admin/quantitativo${nucleo ? `?nucleo=${encodeURIComponent(nucleo)}` : ''}`)
      .then(r => { if (!r.ok) throw new Error('fail'); return r.json(); })
      .then((d: QuantData) => { if (vivo) setData(d); })
      .catch(() => { if (vivo) { setErro('Não foi possível carregar o quantitativo. Tente novamente.'); setData(null); } })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [nucleo]);

  const escopo = nucleo || 'Todos os núcleos';

  const opcoesNucleo = useMemo(() => {
    const nomes = new Set<string>();
    for (const n of dynamicNucleos || []) if (n.nome) nomes.add(n.nome);
    for (const a of data?.alunos || []) if (a.nucleo) nomes.add(a.nucleo);
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [dynamicNucleos, data]);

  const maxFaixa = Math.max(1, ...(data?.faixas.map(f => f.quantidade) || [1]));
  const pct = (v: number) => (data && data.total > 0 ? Math.round((v / data.total) * 100) : 0);
  const baseCirculo = data ? data.maiores + data.menores : 0;
  const pctMenores = baseCirculo > 0 ? Math.round((data!.menores / baseCirculo) * 100) : 0;

  /** PDF / impressão: documento A4 autossuficiente com o cabeçalho oficial. */
  const gerarPdf = () => {
    if (!data) return;
    setGerando(true);
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const geradoEm = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    const org = config.organization_name || 'Centro Cultural Luta Negra';
    const maxF = Math.max(1, ...data.faixas.map(f => f.quantidade));

    const linhas = data.alunos.map((a, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${esc(a.nome)}</td>
        <td class="num">${a.idade ?? '—'}</td>
        <td class="num">${a.data_nascimento ? fmtData(a.data_nascimento) : '—'}</td>
        <td class="num">${esc(fmtCPF(a.cpf))}</td>
        <td class="num">${a.menor ? 'Menor de idade' : 'Maior de idade'}</td>
        <td>${a.menor ? (esc(a.resp_nome) || '—') : '—'}</td>
        <td class="num">${a.menor && a.resp_cpf ? esc(fmtCPF(a.resp_cpf)) : '—'}</td>
      </tr>`).join('');

    const linhasFaixas = data.faixas.map(f => `
      <div class="frow">
        <div class="flabel">${esc(f.label)}</div>
        <div class="fbar-wrap"><div class="fbar" style="width:${Math.round((f.quantidade / maxF) * 100)}%"></div></div>
        <div class="fval">${f.quantidade}</div>
      </div>`).join('');

    const nucleosRows = data.por_nucleo.map(n => `
      <tr>
        <td>${esc(n.nucleo)}</td>
        <td class="num">${n.total}</td>
        <td class="num">${n.maiores}</td>
        <td class="num">${n.menores}</td>
      </tr>`).join('');

    const w = window.open('', '_blank');
    if (!w) { setGerando(false); return; }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório Quantitativo — ${esc(org)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size:A4; margin:14mm 12mm; }
  body { font-family:Arial,Helvetica,sans-serif; color:#111827; font-size:11px; }
  .head { display:flex; align-items:center; gap:14px; border-bottom:3px solid #FF9200; padding-bottom:10px; margin-bottom:12px; }
  .brand { flex:1; }
  .brand h1 { font-size:16px; color:#111827; letter-spacing:.2px; }
  .brand .sub { font-size:10px; color:#6b7280; margin-top:2px; }
  .cards { display:flex; gap:8px; margin:10px 0 14px; }
  .card { flex:1; border:1px solid #e5e7eb; border-radius:8px; padding:8px 10px; border-top:3px solid #FF9200; }
  .card .v { font-size:19px; font-weight:800; }
  .card .l { font-size:9px; color:#6b7280; text-transform:uppercase; letter-spacing:.4px; margin-top:1px; }
  .secao { font-size:12px; font-weight:800; margin:14px 0 6px; color:#111827; }
  table { width:100%; border-collapse:collapse; }
  th, td { border:1px solid #d1d5db; padding:4px 6px; text-align:left; }
  th { background:#f3f4f6; font-size:9.5px; text-transform:uppercase; letter-spacing:.3px; }
  td.num, th.num { text-align:center; }
  tr { page-break-inside:avoid; }
  .frow { display:flex; align-items:center; gap:8px; margin:4px 0; }
  .flabel { width:80px; font-size:10px; color:#374151; }
  .fbar-wrap { flex:1; background:#f3f4f6; border-radius:4px; height:14px; overflow:hidden; }
  .fbar { height:100%; background:linear-gradient(90deg,#FF9200,#e07800); border-radius:4px; }
  .fval { width:30px; text-align:right; font-weight:700; font-size:10px; }
  .pie { display:flex; gap:8px; margin:8px 0 4px; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:4px; vertical-align:-1px; }
  .foot { margin-top:16px; padding-top:8px; border-top:1px solid #e5e7eb; font-size:9px; color:#6b7280; display:flex; justify-content:space-between; }
  .menor-badge { color:#b45309; font-weight:700; }
</style></head><body>
<div class="head">
  <div class="brand">
    <h1>${esc(org)}</h1>
    <div class="sub">Relatório Quantitativo de Alunos — ${esc(escopoLabel(nucleo))} · Gerado em ${geradoEm} · Documento de prestação de contas</div>
  </div>
</div>
<div class="cards">
  <div class="card"><div class="v">${data.total}</div><div class="l">Alunos</div></div>
  <div class="card"><div class="v">${data.maiores}</div><div class="l">Maiores de idade</div></div>
  <div class="card"><div class="v">${data.menores}</div><div class="l">Menores de idade</div></div>
  <div class="card"><div class="v">${data.media_idade || '—'}</div><div class="l">Média de idade (anos)</div></div>
</div>
<div class="secao">Composição por idade</div>
<div class="pie">
  <span><span class="dot" style="background:#dc2626"></span>Menores: <strong>${data.menores}</strong> (${pctMenores}%)</span>
  <span><span class="dot" style="background:#16a34a"></span>Maiores: <strong>${data.maiores}</strong> (${baseCirculo ? 100 - pctMenores : 0}%)</span>
  ${data.sem_data_nascimento ? `<span><span class="dot" style="background:#9ca3af"></span>Sem data de nascimento: <strong>${data.sem_data_nascimento}</strong></span>` : ''}
</div>
${linhasFaixas}
${data.por_nucleo.length > 1 ? `<div class="secao">Distribuição por núcleo</div>
<table><thead><tr><th>Núcleo</th><th class="num">Total</th><th class="num">Maiores</th><th class="num">Menores</th></tr></thead><tbody>${nucleosRows}</tbody></table>` : ''}
<div class="secao">Alunos (${data.total})</div>
<table>
  <thead><tr>
    <th class="num" style="width:26px">#</th><th>Nome</th><th class="num" style="width:44px">Idade</th>
    <th class="num" style="width:82px">Nascimento</th><th class="num" style="width:110px">CPF</th>
    <th class="num" style="width:86px">Situação</th><th>Responsável</th><th class="num" style="width:110px">CPF Resp.</th>
  </tr></thead>
  <tbody>${linhas}</tbody>
</table>
<div class="foot">
  <span>${esc(org)} — documento gerado pelo Ginga Gestão</span>
  <span>${geradoEm}</span>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},300);}<\/script>
</body></html>`);
    w.document.close();
    setTimeout(() => setGerando(false), 800);
  };

  return (
    <div>
      {/* Filtros e ações */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="quant-nucleo" style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Núcleo:</label>
        <select
          id="quant-nucleo"
          value={nucleo}
          onChange={e => setNucleo(e.target.value)}
          style={{
            padding: '7px 12px', borderRadius: 8, fontSize: '0.88rem',
            background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', minWidth: 180,
          }}
        >
          <option value="">Todos os núcleos</option>
          {opcoesNucleo.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <button
          onClick={gerarPdf}
          disabled={!data || gerando}
          style={{
            marginLeft: 'auto', background: 'linear-gradient(135deg,#FF9200,#e07800)', border: 'none', color: '#fff',
            padding: '8px 16px', borderRadius: 8, cursor: data ? 'pointer' : 'not-allowed', fontSize: '0.85rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6, opacity: data ? 1 : 0.55,
          }}
        >
          {gerando ? 'Gerando…' : '🖨 Gerar PDF / Imprimir'}
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>Carregando quantitativo…</div>}

      {!loading && erro && (
        <div className="pa-alert pa-alert-error" style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.4)', color: '#f87171' }}>
          {erro}
        </div>
      )}

      {!loading && data && (
        <div>
          {/* Totais — sempre coerentes com o filtro de núcleo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
            <QuantCard valor={data.total} rotulo="Alunos" cor="#FF9200" />
            <QuantCard valor={data.maiores} rotulo="Maiores de idade" cor="#16a34a" detalhe={`${pct(data.maiores)}% do total`} />
            <QuantCard valor={data.menores} rotulo="Menores de idade" cor="#dc2626" detalhe={`${pct(data.menores)}% do total`} />
            <QuantCard valor={data.media_idade || '—'} rotulo="Média de idade" cor="#0891b2" detalhe={data.sem_data_nascimento ? `${data.sem_data_nascimento} sem data de nasc.` : 'anos'} />
          </div>

          {/* Gráficos */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 20 }}>
            {/* Faixas etárias */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
              <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 10 }}>Distribuição por faixa etária</div>
              {data.total === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', padding: '14px 0' }}>Nenhum aluno neste escopo.</div>
              ) : (
                <div>
                  {data.faixas.map(f => (
                    <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{ width: 84, fontSize: '0.72rem', color: 'var(--text-secondary)', textAlign: 'right' }}>{f.label}</div>
                      <div style={{ flex: 1, background: 'var(--bg-input)', borderRadius: 4, height: 14, overflow: 'hidden', border: '1px solid var(--border)' }}>
                        <div style={{ height: '100%', width: `${Math.round((f.quantidade / maxFaixa) * 100)}%`, background: 'linear-gradient(90deg,#FF9200,#e07800)', borderRadius: 4, transition: 'width 0.4s' }} />
                      </div>
                      <div style={{ width: 26, fontSize: '0.75rem', fontWeight: 700, textAlign: 'right' }}>{f.quantidade}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Maiores x Menores */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: 10 }}>Maiores × Menores de idade</div>
              {baseCirculo === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                  Sem idades calculáveis neste escopo{data.sem_data_nascimento ? ` (${data.sem_data_nascimento} aluno(s) sem data de nascimento)` : ''}.
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 18, flex: 1, flexWrap: 'wrap' }}>
                  <Donut pctMenores={pctMenores} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.82rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 999, background: '#dc2626', display: 'inline-block' }} />
                      Menores: <strong>{data.menores}</strong> ({pctMenores}%)
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 11, height: 11, borderRadius: 999, background: '#16a34a', display: 'inline-block' }} />
                      Maiores: <strong>{data.maiores}</strong> ({100 - pctMenores}%)
                    </span>
                    {data.sem_data_nascimento > 0 && (
                      <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                        + {data.sem_data_nascimento} sem data de nascimento
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Resumo por núcleo (só no escopo geral) */}
          {!nucleo && data.por_nucleo.length > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 20 }}>
              {data.por_nucleo.map(n => (
                <div key={n.nucleo} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', borderTop: '3px solid #FF9200' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.82rem', marginBottom: 4 }}>{n.nucleo}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{n.total}</strong> aluno{n.total !== 1 ? 's' : ''}
                    {' · '}<span style={{ color: '#16a34a' }}>{n.maiores} maiores</span>
                    {' · '}<span style={{ color: '#f87171' }}>{n.menores} menores</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tabela de alunos */}
          <div className="table-responsive">
            <table className="student-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Nome</th>
                  <th style={{ textAlign: 'center' }}>Idade</th>
                  <th style={{ textAlign: 'center' }}>Nascimento</th>
                  <th style={{ textAlign: 'center' }}>CPF</th>
                  <th style={{ textAlign: 'center' }}>Situação</th>
                  <th>Responsável</th>
                  <th style={{ textAlign: 'center' }}>CPF Resp.</th>
                </tr>
              </thead>
              <tbody>
                {data.alunos.length === 0 && (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>Nenhum aluno neste escopo.</td></tr>
                )}
                {data.alunos.map((a, i) => (
                  <tr key={a.id}>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{a.nome}</td>
                    <td style={{ textAlign: 'center' }}>{a.idade ?? '—'}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{a.data_nascimento ? fmtData(a.data_nascimento) : '—'}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{fmtCPF(a.cpf)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
                        background: a.menor ? 'rgba(220,38,38,0.14)' : 'rgba(22,163,74,0.14)',
                        color: a.menor ? '#f87171' : '#4ade80',
                      }}>
                        {a.menor ? 'Menor' : 'Maior'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.84rem' }}>{a.menor ? (a.resp_nome || '—') : '—'}</td>
                    <td style={{ textAlign: 'center', fontSize: '0.82rem' }}>{a.menor && a.resp_cpf ? fmtCPF(a.resp_cpf) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Escopo: <strong>{escopo}</strong> · {data.total} aluno{data.total !== 1 ? 's' : ''} · dados de menores incluem o responsável registrado no termo de responsabilidade.
          </div>
        </div>
      )}
    </div>
  );
}

function escopoLabel(nucleo: string): string {
  return nucleo ? `Núcleo ${nucleo}` : 'Todos os núcleos';
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function QuantCard({ valor, rotulo, cor, detalhe }: { valor: number | string; rotulo: string; cor: string; detalhe?: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.4px', color: cor, fontWeight: 700, marginTop: 3 }}>{rotulo}</div>
      {detalhe && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>{detalhe}</div>}
    </div>
  );
}

function Donut({ pctMenores }: { pctMenores: number }) {
  const r = 52;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(100, pctMenores)) / 100;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Menores de idade: ${pctMenores}%`}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#16a34a" strokeWidth="18" />
      <circle
        cx="70" cy="70" r={r} fill="none" stroke="#dc2626" strokeWidth="18"
        strokeDasharray={`${C * frac} ${C}`} strokeDashoffset={C * 0.25} strokeLinecap="butt"
      />
      <text x="70" y="66" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="800">{pctMenores}%</text>
      <text x="70" y="84" textAnchor="middle" fill="var(--text-secondary)" fontSize="9">menores</text>
    </svg>
  );
}
