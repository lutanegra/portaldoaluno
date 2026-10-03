'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useSystemConfig } from '@/hooks/useSystemConfig';

/**
 * RELATÓRIO DE UNIFORMES — aba Relatórios do painel (v1.6.4).
 * Lista de alunos com as medidas de uniforme lançadas pela administração
 * (ficha 👕), para conferência da confecção. Filtro por núcleo coerente com
 * o perfil do admin; PDF/impressão em A4 retrato no padrão da Folha de
 * Chamada: logo do grupo, título, botão no papel e células em branco para
 * preenchimento manual de quem ainda não tem medida.
 */

type AlunoUniforme = {
  id: string;
  nome: string;
  apelido: string;
  nucleo: string;
  graduacao: string;
  matricula: string;
  camisa_tamanho: string;
  calca_altura: string;
  calca_cintura: string;
  calca_gaviao: string;
  camisa_grupo: string;
  camisa_projeto: string;
};

type UniformesData = {
  total: number;
  com_medidas: number;
  sem_medidas: number;
  alunos: AlunoUniforme[];
};

const temMedidas = (a: AlunoUniforme): boolean =>
  !!(a.camisa_tamanho || a.calca_altura || a.calca_cintura || a.calca_gaviao || a.camisa_grupo || a.camisa_projeto);

/** Compacta "Primeiro + meio abreviado + Último" (mesma regra da Folha de Chamada). */
function abreviarNome(nome: string): string {
  const partes = String(nome || '').trim().split(/\s+/);
  if (partes.length <= 2) return partes.join(' ');
  return `${partes[0]} ${partes.slice(1, -1).map(p => `${p.charAt(0).toUpperCase()}.`).join(' ')} ${partes[partes.length - 1]}`;
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export default function UniformesPanel({
  nucleoFilter,
  dynamicNucleos,
}: {
  nucleoFilter: string | null;
  dynamicNucleos: Array<{ nome: string; slug: string }>;
}) {
  const { config } = useSystemConfig();
  const [nucleo, setNucleo] = useState(nucleoFilter || '');
  const [data, setData] = useState<UniformesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);

  useEffect(() => { setNucleo(nucleoFilter || ''); }, [nucleoFilter]);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    setErro('');
    fetch(`/api/admin/uniformes${nucleo ? `?nucleo=${encodeURIComponent(nucleo)}` : ''}`)
      .then(r => { if (!r.ok) throw new Error('fail'); return r.json(); })
      .then((d: UniformesData) => { if (vivo) setData(d); })
      .catch(() => { if (vivo) { setErro('Não foi possível carregar o relatório de uniformes. Tente novamente.'); setData(null); } })
      .finally(() => { if (vivo) setLoading(false); });
    return () => { vivo = false; };
  }, [nucleo]);

  const opcoesNucleo = useMemo(() => {
    const nomes = new Set<string>();
    for (const n of dynamicNucleos || []) if (n.nome) nomes.add(n.nome);
    for (const a of data?.alunos || []) if (a.nucleo) nomes.add(a.nucleo);
    return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [dynamicNucleos, data]);

  const escopoLabel = nucleo ? `Núcleo ${nucleo}` : 'Todos os núcleos';

  /** PDF / impressão — A4 retrato, padrão da Folha de Chamada. */
  const gerarPdf = () => {
    if (!data) return;
    setGerando(true);
    const org = config.organization_name || 'Centro Cultural Luta Negra';
    const orgShort = config.organization_short || 'CCLN';
    const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    const geradoEm = agora.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

    // Logo em URL absoluta (documento blob não resolve caminho relativo).
    const logoSrc = config.logo_url || '/logo-portal-aluno.png';
    let logoTag = '';
    try {
      const logoAbs = new URL(logoSrc, window.location.href).href;
      logoTag = `<img class="logo" src="${esc(logoAbs)}" alt="">`;
    } catch { /* logo inválida: cabeçalho segue só com texto */ }

    const celula = (v: string) => (String(v || '').trim() ? esc(String(v).trim()) : '');
    const linhas = data.alunos.map((a, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="nome">${esc(abreviarNome(a.nome))}${!nucleo && a.nucleo ? `<span class="nucleo">${esc(a.nucleo)}</span>` : ''}</td>
        <td class="mat">${celula(a.matricula)}</td>
        <td class="med">${celula(a.camisa_tamanho)}</td>
        <td class="med">${celula(a.calca_altura)}</td>
        <td class="med">${celula(a.calca_cintura)}</td>
        <td class="med">${celula(a.calca_gaviao)}</td>
        <td class="med">${celula(a.camisa_grupo)}</td>
        <td class="med">${celula(a.camisa_projeto)}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório de Uniformes — ${esc(nucleo || 'Todos os núcleos')}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size:A4 portrait; margin:12mm 12mm 14mm; }
  body { font-family:Arial,Helvetica,sans-serif; color:#111827; font-size:11px;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .barra { display:flex; justify-content:flex-end; margin-bottom:10px; }
  .btn-print { font-family:inherit; font-size:12.5px; font-weight:800; padding:9px 18px; border-radius:9px;
    border:1px solid #FF9200; background:rgba(255,146,0,.14); color:#b26a00; cursor:pointer; }
  .btn-print:hover { background:rgba(255,146,0,.3); }
  @media print { .barra { display:none; } }
  .head { display:flex; align-items:center; gap:14px; border-bottom:3px solid #FF9200; padding-bottom:10px; }
  .logo { width:62px; height:62px; object-fit:contain; flex-shrink:0; }
  .brand { flex:1; min-width:0; }
  .brand h1 { font-size:16.5px; letter-spacing:.3px; text-transform:uppercase; }
  .brand .sub { font-size:9.5px; color:#6b7280; margin-top:3px; letter-spacing:.4px; text-transform:uppercase; }
  .data-box { border:1.5px solid #9ca3af; border-radius:8px; padding:7px 12px; text-align:center; flex-shrink:0; }
  .data-box .lbl { font-size:8px; font-weight:800; color:#6b7280; letter-spacing:1px; text-transform:uppercase; }
  .data-box .val { font-size:12px; font-weight:700; margin-top:4px; letter-spacing:1px; }
  .titulo-bloco { text-align:center; margin:14px 0 12px; }
  .titulo-doc { font-size:15px; font-weight:800; text-transform:uppercase; letter-spacing:2.5px; }
  .titulo-sub { font-size:9.5px; color:#6b7280; margin-top:3px; letter-spacing:.3px; }
  .titulo-linha { width:64px; height:3px; background:#FF9200; border-radius:2px; margin:7px auto 0; }
  .meta { display:flex; justify-content:space-between; align-items:center; background:#f9fafb;
    border:1px solid #e5e7eb; border-radius:8px; padding:7px 12px; font-size:10px; margin-bottom:10px; }
  .meta strong { font-size:11px; }
  table { width:100%; border-collapse:collapse; }
  th, td { border:1px solid #9ca3af; padding:0 6px; height:24px; }
  th { background:#f3f4f6; color:#111827; font-size:8px; text-transform:uppercase; letter-spacing:.6px;
    height:auto; padding:6px 6px; text-align:left; border-bottom:2px solid #111827; }
  thead { display:table-header-group; }
  tr { page-break-inside:avoid; }
  td.num, th.num { text-align:center; width:22px; color:#6b7280; font-size:10px; }
  td.nome { font-size:10.5px; font-weight:600; color:#111827; }
  td.nome .nucleo { display:block; font-size:7.5px; font-weight:400; color:#6b7280; letter-spacing:.2px; }
  th.mat, td.mat { width:62px; font-size:9.5px; text-align:center; color:#374151; }
  th.med, td.med { width:52px; text-align:center; font-size:10.5px; }
  th.legenda { border:none; background:none; padding:8px 2px 3px; font-size:8px; color:#6b7280;
    font-weight:800; text-transform:uppercase; letter-spacing:.8px; }
  .resumo { margin-top:10px; display:flex; gap:8px; }
  .resumo .cx { flex:1; border:1px solid #d1d5db; border-radius:8px; padding:6px 10px 18px; font-size:9px;
    color:#374151; font-weight:700; text-transform:uppercase; letter-spacing:.5px; }
  .foot { margin-top:14px; padding-top:8px; border-top:1px solid #e5e7eb; font-size:8.5px; color:#6b7280;
    display:flex; justify-content:space-between; }
</style></head><body>
<div class="barra"><button class="btn-print" onclick="window.print()">🖨&nbsp; Imprimir / Salvar PDF</button></div>
<div class="head">
  ${logoTag}
  <div class="brand">
    <h1>${esc(org)}</h1>
    <div class="sub">Portal do Aluno · Ginga Gestão</div>
  </div>
  <div class="data-box"><div class="lbl">Gerado em</div><div class="val">${esc(geradoEm)}</div></div>
</div>
<div class="titulo-bloco">
  <div class="titulo-doc">Relatório de Uniformes</div>
  <div class="titulo-sub">Tamanhos para confecção — campos em branco ficam para preenchimento manual</div>
  <div class="titulo-linha"></div>
</div>
<div class="meta">
  <span>Escopo: <strong>${esc(escopoLabel)}</strong></span>
  <span>${data.total} aluno${data.total !== 1 ? 's' : ''} · ${data.com_medidas} com medida${data.com_medidas !== 1 ? 's' : ''} · ${data.sem_medidas} sem medida${data.sem_medidas !== 1 ? 's' : ''}</span>
</div>
<table>
  <thead><tr>
    <th class="num">#</th><th>Nome do Aluno</th><th class="mat">Matrícula</th>
    <th class="med">Camisa</th><th class="med">Altura</th><th class="med">Cintura</th><th class="med">Gavião</th>
    <th class="med">Cam. Grupo</th><th class="med">Cam. Projeto</th>
  </tr></thead>
  <tbody>${linhas}</tbody>
  <tr><th class="legenda" colspan="9">Altura, cintura e gavião referem-se à calça · Cam. = camisa</th></tr>
</table>
<div class="resumo">
  <div class="cx">Total de alunos: ${data.total}</div>
  <div class="cx">Conferido pela confecção: ____________</div>
  <div class="cx">Assinatura: ____________</div>
</div>
<div class="foot">
  <span>${esc(orgShort)} · ${esc(org)} — documento gerado pelo Ginga Gestão</span>
  <span>${esc(geradoEm)}</span>
</div>
</body></html>`;

    // Janela com endereço próprio (blob): título correto na impressão/PDF.
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) {
      URL.revokeObjectURL(url);
      setErro('O navegador bloqueou a janela do documento. Permita pop-ups para este site e tente novamente.');
      setGerando(false);
      return;
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setTimeout(() => setGerando(false), 800);
  };

  return (
    <div>
      {/* Filtros e ações */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="unif-nucleo" style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Núcleo:</label>
        <select
          id="unif-nucleo"
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
          disabled={!data || gerando || data.total === 0}
          style={{
            marginLeft: 'auto', background: 'linear-gradient(135deg,#FF9200,#e07800)', border: 'none', color: '#fff',
            padding: '8px 16px', borderRadius: 8, cursor: data && data.total > 0 ? 'pointer' : 'not-allowed', fontSize: '0.85rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6, opacity: data && data.total > 0 ? 1 : 0.55,
          }}
        >
          {gerando ? 'Gerando…' : '🖨 Gerar PDF / Imprimir'}
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>Carregando uniformes…</div>}

      {!loading && erro && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.4)', color: '#f87171' }}>
          {erro}
        </div>
      )}

      {!loading && data && (
        <div>
          {/* Resumo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
            <ResumoCard valor={data.total} rotulo="Alunos no escopo" cor="#FF9200" />
            <ResumoCard valor={data.com_medidas} rotulo="Com medidas lançadas" cor="#16a34a" />
            <ResumoCard valor={data.sem_medidas} rotulo="Sem medidas" cor="#dc2626" detalhe="Preencha na ficha 👕 do aluno" />
          </div>

          {/* Tabela */}
          <div className="table-responsive">
            <table className="student-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th>Nome</th>
                  <th style={{ textAlign: 'center' }}>Matrícula</th>
                  <th style={{ textAlign: 'center' }}>Camisa</th>
                  <th style={{ textAlign: 'center' }}>Altura</th>
                  <th style={{ textAlign: 'center' }}>Cintura</th>
                  <th style={{ textAlign: 'center' }}>Gavião</th>
                  <th style={{ textAlign: 'center' }}>Cam. Grupo</th>
                  <th style={{ textAlign: 'center' }}>Cam. Projeto</th>
                </tr>
              </thead>
              <tbody>
                {data.alunos.length === 0 && (
                  <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--text-secondary)' }}>Nenhum aluno neste escopo.</td></tr>
                )}
                {data.alunos.map((a, i) => (
                  <tr key={a.id} style={{ opacity: temMedidas(a) ? 1 : 0.75 }}>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>
                      {a.nome}
                      {!nucleo && a.nucleo && (
                        <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 400 }}>{a.nucleo}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{a.matricula || '—'}</td>
                    <td style={{ textAlign: 'center', fontWeight: 700 }}>{a.camisa_tamanho || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{a.calca_altura || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{a.calca_cintura || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{a.calca_gaviao || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{a.camisa_grupo || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{a.camisa_projeto || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Escopo: <strong>{escopoLabel}</strong> · {data.total} aluno{data.total !== 1 ? 's' : ''} · medidas lançadas pela administração na ficha de uniforme; no PDF, células em branco ficam para anotar à mão.
          </div>
        </div>
      )}
    </div>
  );
}

function ResumoCard({ valor, rotulo, cor, detalhe }: { valor: number | string; rotulo: string; cor: string; detalhe?: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.4px', color: cor, fontWeight: 700, marginTop: 3 }}>{rotulo}</div>
      {detalhe && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>{detalhe}</div>}
    </div>
  );
}
