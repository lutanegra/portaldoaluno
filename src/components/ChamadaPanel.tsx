'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  IconCheck, IconWarn, IconMapPin, IconClock, IconSearch, IconRefresh,
} from '@/components/icons';
import { useSystemConfig } from '@/hooks/useSystemConfig';

export type ChamadaAluno = {
  id: string;
  nome_completo: string;
  apelido?: string | null;
  graduacao?: string | null;
  foto_url?: string | null;
};

export type ChamadaEntryAPI = { id: string; st: 'P' | 'F' | 'JU'; h?: string; src?: string };

type NucleoInfo = {
  slug: string;
  nome: string;
  endereco?: string;
  cidade?: string;
  estado?: string;
  lat?: number | null;
  lng?: number | null;
  dias_treino?: string[];
};

const DIAS_ROTULO: Record<string, string> = {
  segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta',
  sexta: 'Sexta', sabado: 'Sábado', domingo: 'Domingo',
};

export function formatarDataBR(data: string): string {
  const [y, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

/** Escape para o HTML da folha de chamada (documento aberto em janela separada). */
function escFolha(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Chamada diária: todos os alunos do núcleo começam como FALTA; o admin
 * toca apenas em quem está PRESENTE. Salva a chamada inteira de uma vez.
 */
export default function ChamadaPanel({
  nucleoSlug,
  nucleosPermitidos,
  podeTrocarNucleo,
  dataInicial,
  onAudit,
}: {
  nucleoSlug: string;
  nucleosPermitidos: Array<{ slug: string; nome: string }>;
  podeTrocarNucleo: boolean;
  dataInicial: string;
  onAudit?: (msg: string) => void;
}) {
  const [nucleo, setNucleo] = useState(nucleoSlug);
  const [data, setData] = useState(dataInicial);
  const [nucleoInfo, setNucleoInfo] = useState<NucleoInfo | null>(null);
  const [treinoExistente, setTreinoExistente] = useState(true);
  const [diaSemana, setDiaSemana] = useState<string>('');
  const [alunos, setAlunos] = useState<ChamadaAluno[]>([]);
  const [estados, setEstados] = useState<Record<string, 'P' | 'F' | 'JU'>>({});
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [salvoPor, setSalvoPor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [confirmar, setConfirmar] = useState(false);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'P' | 'F' | 'JU'>('todos');
  const [gerandoFolha, setGerandoFolha] = useState(false);
  const { config } = useSystemConfig();

  async function carregar(dataArg = data, nucleoArg = nucleo) {
    setLoading(true);
    setErro('');
    setMsg('');
    setConfirmar(false);
    try {
      const res = await fetch(`/api/chamada?data=${dataArg}&nucleo=${encodeURIComponent(nucleoArg)}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok) {
        setErro(d.error || 'Erro ao carregar a chamada.');
        setAlunos([]);
        setEstados({});
        return;
      }
      setNucleoInfo(d.nucleo);
      setTreinoExistente(!!d.treinoExistente);
      setDiaSemana(d.diaSemana || '');
      const lista: ChamadaAluno[] = d.alunos || [];
      // Ordem alfabética garantida por nome completo (case/diacritics-insensitive)
      lista.sort((a, b) => String(a.nome_completo).localeCompare(String(b.nome_completo), 'pt-BR', { sensitivity: 'base' }));
      setAlunos(lista);
      const est: Record<string, 'P' | 'F' | 'JU'> = {};
      for (const a of lista) est[a.id] = 'F'; // todo aluno começa como FALTA
      for (const e of (d.entries || []) as ChamadaEntryAPI[]) {
        if (est[e.id] !== undefined) est[e.id] = e.st; // chamada/checkin existente prevalece
      }
      setEstados(est);
      setSalvoEm(d.salvoEm || null);
      setSalvoPor(d.salvoPor || null);
    } catch {
      setErro('Erro de conexão ao carregar a chamada.');
    }
    setLoading(false);
  }

  // Carrega ao montar e quando núcleo/data externos mudam
  useEffect(() => { carregar(dataInicial, nucleoSlug); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [nucleoSlug, dataInicial]);

  function alternar(id: string) {
    setMsg('');
    setEstados(prev => ({ ...prev, [id]: prev[id] === 'P' ? 'F' : 'P' }));
  }

  function definir(id: string, st: 'P' | 'F' | 'JU') {
    setMsg('');
    setEstados(prev => ({ ...prev, [id]: st }));
  }

  const total = alunos.length;
  const presentes = useMemo(() => alunos.filter(a => estados[a.id] === 'P').length, [alunos, estados]);
  const faltas = useMemo(() => alunos.filter(a => estados[a.id] === 'F').length, [alunos, estados]);
  const justificadas = useMemo(() => alunos.filter(a => estados[a.id] === 'JU').length, [alunos, estados]);
  const pct = total > 0 ? Math.round((presentes / total) * 100) : 0;

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return alunos.filter(a => {
      if (q && !String(a.nome_completo).toLowerCase().includes(q)) return false;
      if (filtro !== 'todos' && estados[a.id] !== filtro) return false;
      return true;
    });
  }, [alunos, estados, busca, filtro]);

  const alterados = useMemo(
    () => alunos.filter(a => {
      const e = estados[a.id];
      return e === 'P' || e === 'JU';
    }).length,
    [alunos, estados],
  );

  async function salvar() {
    if (!treinoExistente || saving) return;
    setSaving(true);
    setMsg('');
    try {
      const entries = alunos.map(a => ({ id: a.id, st: estados[a.id] || 'F' }));
      const res = await fetch('/api/chamada', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, nucleo, entries }),
      });
      const d = await res.json();
      if (!res.ok) {
        setMsg(d.error || 'Erro ao salvar a chamada.');
        setConfirmar(false);
      } else {
        setSalvoEm(d.salvoEm || new Date().toISOString());
        setSalvoPor('você');
        setMsg(`✓ Chamada salva: ${d.resumo?.presentes ?? 0} presentes, ${d.resumo?.faltas ?? 0} faltas, ${d.resumo?.justificadas ?? 0} justificadas.`);
        setConfirmar(false);
        onAudit?.('Chamada salva.');
      }
    } catch {
      setMsg('Erro de conexão ao salvar.');
      setConfirmar(false);
    }
    setSaving(false);
  }

  /** Compacta "Primeiro + meio abreviado + Último" (ex.: "Raphael S. Scoralick"). */
  function abreviarNome(nome: string): string {
    const partes = String(nome || '').trim().split(/\s+/);
    if (partes.length <= 2) return partes.join(' ');
    return `${partes[0]} ${partes.slice(1, -1).map(p => `${p.charAt(0).toUpperCase()}.`).join(' ')} ${partes[partes.length - 1]}`;
  }

  /**
   * FOLHA DE CHAMADA (v1.5.5): documento A4 paisagem para assinatura em papel.
   * Topo: título, nome do grupo, nome do núcleo e data. Lista dos alunos
   * cadastrados até o momento da geração em ordem alfabética (nomes do meio
   * abreviados), coluna de apelidos e campo de assinatura ao lado. Linhas em
   * branco no fim para inclusões manuais. Cabeçalho se repete a cada página.
   */
  function gerarFolha() {
    if (alunos.length === 0 || gerandoFolha) return;
    setGerandoFolha(true);
    const org = config.organization_name || 'Centro Cultural Luta Negra';
    const nomeNucleo = nucleosPermitidos.find(n => n.slug === nucleo)?.nome || nucleoInfo?.nome || nucleo;

    // Reordena no momento da geração (o servidor já entrega alfabético; aqui é garantia)
    const lista = [...alunos].sort((a, b) =>
      String(a.nome_completo).localeCompare(String(b.nome_completo), 'pt-BR', { sensitivity: 'base' }));

    const linhas = lista.map((a, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="nome">${escFolha(abreviarNome(a.nome_completo))}</td>
        <td class="apelido">${escFolha(String(a.apelido || '').trim())}</td>
        <td class="ass"></td>
      </tr>`).join('');

    // Espaços para quem ficou de fora (alunos novos / esquecimentos)
    const LINHAS_EXTRAS = 8;
    let extras = '';
    for (let i = 1; i <= LINHAS_EXTRAS; i++) {
      extras += `
      <tr class="extra">
        <td class="num">+</td>
        <td class="nome"></td>
        <td class="apelido"></td>
        <td class="ass"></td>
      </tr>`;
    }

    const w = window.open('', '_blank');
    if (!w) {
      setMsg('O navegador bloqueou a janela do documento. Permita pop-ups para este site e tente novamente.');
      setGerandoFolha(false);
      return;
    }
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Folha de Chamada — ${escFolha(nomeNucleo)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size:A4 landscape; margin:11mm 12mm; }
  body { font-family:Arial,Helvetica,sans-serif; color:#111827; font-size:11px; }
  .barra { display:flex; justify-content:flex-end; margin-bottom:8px; }
  .btn-print { font-family:inherit; font-size:12px; font-weight:800; padding:8px 16px; border-radius:8px;
    border:1px solid #FF9200; background:rgba(255,146,0,.14); color:#b26a00; cursor:pointer; }
  .btn-print:hover { background:rgba(255,146,0,.28); }
  @media print { .barra { display:none; } body { font-size:11px; } }
  .head { display:flex; align-items:center; gap:14px; border-bottom:3px solid #FF9200; padding-bottom:8px; margin-bottom:4px; }
  .brand { flex:1; }
  .brand h1 { font-size:15px; letter-spacing:.2px; }
  .brand .sub { font-size:9.5px; color:#6b7280; margin-top:2px; }
  .titulo-doc { text-align:center; font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:1.2px; margin:10px 0 2px; }
  .meta { text-align:center; font-size:9.5px; color:#6b7280; margin-bottom:9px; }
  table { width:100%; border-collapse:collapse; }
  th, td { border:1px solid #9ca3af; padding:0 8px; height:26px; }
  th { background:#f3f4f6; font-size:9px; text-transform:uppercase; letter-spacing:.4px; height:auto; padding:5px 8px; }
  td.num, th.num { text-align:center; width:30px; }
  td.nome { font-size:11.5px; font-weight:600; }
  td.apelido, th.apelido { width:120px; font-size:10.5px; }
  th.ass, td.ass { width:280px; }
  thead { display:table-header-group; }
  tr { page-break-inside:avoid; }
  tr.extra td.num { color:#9ca3af; font-weight:700; }
  .total { margin-top:8px; font-size:9.5px; color:#374151; display:flex; justify-content:space-between; }
  .foot { margin-top:12px; padding-top:8px; border-top:1px solid #e5e7eb; font-size:9px; color:#6b7280; display:flex; justify-content:space-between; }
</style></head><body>
<div class="barra"><button class="btn-print" onclick="window.print()">🖨&nbsp; Imprimir / Salvar PDF</button></div>
<div class="head">
  <div class="brand">
    <h1>${escFolha(org)}</h1>
    <div class="sub">Portal do Aluno · Ginga Gestão</div>
  </div>
</div>
<div class="titulo-doc">Folha de Chamada</div>
<div class="meta">Núcleo: <strong>${escFolha(nomeNucleo)}</strong> · Data: <strong>____/____/______</strong> · ${lista.length} aluno${lista.length !== 1 ? 's' : ''} cadastrado${lista.length !== 1 ? 's' : ''} até o momento da geração</div>
<table>
  <thead><tr>
    <th class="num">#</th><th>Nome do Aluno</th><th class="apelido">Apelido</th><th class="ass">Assinatura</th>
  </tr></thead>
  <tbody>${linhas}${extras}</tbody>
</table>
<div class="total"><span>Total de alunos listados: <strong>${lista.length}</strong></span><span>Presenças do dia: ______ &nbsp;·&nbsp; Ausências: ______</span></div>
<div class="foot">
  <span>${escFolha(org)} — documento gerado pelo Ginga Gestão</span>
  <span>Professor / Responsável: ____________________________</span>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},400);}<\\/script>
</body></html>`);
    w.document.close();
    setTimeout(() => setGerandoFolha(false), 800);
  }

  const inputStyle: React.CSSProperties = {
    padding: '9px 12px', borderRadius: 9, border: '1px solid var(--border)',
    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.86rem', outline: 'none',
  };
  const chip = (ativo: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 20, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
    border: ativo ? '1px solid rgba(255,146,0,0.55)' : '1px solid var(--border)',
    background: ativo ? 'rgba(255,146,0,0.14)' : 'var(--bg-input)',
    color: ativo ? '#FF9200' : 'var(--text-secondary)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Cabeçalho: núcleo + data */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        {podeTrocarNucleo && nucleosPermitidos.length > 1 ? (
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Núcleo</label>
            <select value={nucleo} onChange={e => { const v = e.target.value; setNucleo(v); carregar(data, v); }} style={{ ...inputStyle, minWidth: 220 }}>
              {nucleosPermitidos.map(n => <option key={n.slug} value={n.slug}>{n.nome}</option>)}
            </select>
          </div>
        ) : (
          <div>
            <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Núcleo</label>
            <div style={{ ...inputStyle, minWidth: 220, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconMapPin size={13} /> {nucleosPermitidos.find(n => n.slug === nucleo)?.nome || nucleoInfo?.nome || nucleo}
            </div>
          </div>
        )}
        <div>
          <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data da chamada</label>
          <input type="date" value={data} onChange={e => { const v = e.target.value; setData(v); carregar(v, nucleo); }} style={inputStyle} />
        </div>
        <button onClick={() => carregar()} disabled={loading}
          style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 6, cursor: loading ? 'wait' : 'pointer', fontWeight: 700 }}>
          <IconRefresh size={14} style={loading ? { animation: 'spin 0.8s linear infinite' } : undefined} /> Atualizar
        </button>
        <button
          onClick={gerarFolha}
          disabled={loading || alunos.length === 0 || gerandoFolha}
          title="Gera a folha de chamada em ordem alfabética, com campo de assinatura para cada aluno"
          style={{
            ...inputStyle, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800,
            cursor: loading || alunos.length === 0 ? 'not-allowed' : 'pointer',
            opacity: loading || alunos.length === 0 ? 0.55 : 1,
            background: 'linear-gradient(135deg, rgba(255,146,0,0.18), rgba(255,146,0,0.06))',
            borderColor: 'rgba(255,146,0,0.5)', color: '#FF9200',
          }}
        >
          🖨 {gerandoFolha ? 'Gerando…' : 'Folha de Chamada'}
        </button>
        {salvoEm && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
            Última chamada salva {new Date(salvoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {salvoPor && salvoPor !== 'você' ? ` · por ${salvoPor}` : ''}
          </div>
        )}
      </div>

      {/* Dia sem treino */}
      {!loading && !treinoExistente && (
        <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 14, padding: '18px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }}><IconWarn size={20} /></span>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#fbbf24', marginBottom: 4 }}>Não existe treino deste núcleo nesta data</div>
            <div style={{ fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {formatarDataBR(data)} cai em <strong>{DIAS_ROTULO[diaSemana] || diaSemana}</strong>, e os dias de treino cadastrados são:{' '}
              <strong>{(nucleoInfo?.dias_treino || []).map(d => DIAS_ROTULO[d] || d).join(', ') || 'nenhum'}</strong>.
              A chamada só pode ser registrada em dias de treino — consulte outra data ou ajuste os dias do núcleo.
            </div>
          </div>
        </div>
      )}

      {/* Contador em tempo real */}
      {!loading && alunos.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{total} alunos</span>
            </div>
            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#22c55e' }}>● {presentes} presentes</span>
            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#ef4444' }}>● {faltas} faltas</span>
            {justificadas > 0 && <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#eab308' }}>● {justificadas} justificadas</span>}
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginLeft: 'auto', fontWeight: 600 }}>
              Toque no aluno para marcá-lo presente
            </span>
          </div>
          <div style={{ marginTop: 10, height: 8, borderRadius: 6, background: 'rgba(239,68,68,0.15)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', borderRadius: 6, background: 'linear-gradient(90deg,#FF9200,#fbbf24)', transition: 'width 0.25s ease' }} />
          </div>
          <div style={{ marginTop: 5, fontSize: '0.72rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>{presentes} de {total} presentes · {pct}%</div>
        </div>
      )}

      {/* Busca + filtros rápidos */}
      {!loading && alunos.length > 0 && treinoExistente && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 320 }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', display: 'flex' }}><IconSearch size={14} /></span>
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar aluno na lista..."
              style={{ ...inputStyle, width: '100%', paddingLeft: 32 }} />
          </div>
          <button onClick={() => setFiltro('todos')} style={chip(filtro === 'todos')}>Todos</button>
          <button onClick={() => setFiltro('P')} style={chip(filtro === 'P')}>Presentes</button>
          <button onClick={() => setFiltro('F')} style={chip(filtro === 'F')}>Faltas</button>
          <button onClick={() => setFiltro('JU')} style={chip(filtro === 'JU')}>Justificadas</button>
          {alterados > 0 && !salvoEm && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>({alterados} marcados como presentes — salve para registrar)</span>
          )}
        </div>
      )}

      {/* Lista da chamada */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '42px 20px', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
          Carregando chamada...
        </div>
      ) : erro ? (
        <div style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 14, padding: 20, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, color: '#f87171', marginBottom: 6 }}>Erro ao carregar a chamada</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{erro}</div>
        </div>
      ) : alunos.length === 0 ? (
        <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border)', borderRadius: 14, padding: 28, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
          Nenhum aluno ativo vinculado a este núcleo.
        </div>
      ) : treinoExistente ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {visiveis.map(a => {
            const st = estados[a.id] || 'F';
            const presente = st === 'P';
            const justif = st === 'JU';
            return (
              <div key={a.id}
                onClick={() => !justif && alternar(a.id)}
                role="button" tabIndex={0}
                onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !justif) { e.preventDefault(); alternar(a.id); } }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  background: presente ? 'rgba(34,197,94,0.08)' : justif ? 'rgba(234,179,8,0.07)' : 'var(--bg-card)',
                  border: presente ? '1px solid rgba(34,197,94,0.4)' : justif ? '1px solid rgba(234,179,8,0.4)' : '1px solid var(--border)',
                  borderRadius: 12, padding: '10px 14px', cursor: justif ? 'default' : 'pointer',
                  transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
                }}>
                {a.foto_url
                  ? <img src={a.foto_url} alt="" style={{ width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                  : <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'rgba(255,146,0,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#FF9200' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.8rem' }}>{String(a.nome_completo).trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()}</span>
                    </div>}
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>{a.nome_completo}</div>
                  {a.graduacao && <div style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)' }}>{a.graduacao}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                  <button type="button" onClick={() => alternar(a.id)} title="Marcar presente"
                    style={{
                      padding: '7px 14px', borderRadius: 9, fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer',
                      border: presente ? '1px solid rgba(34,197,94,0.6)' : '1px solid var(--border)',
                      background: presente ? 'linear-gradient(135deg,#22c55e,#15803d)' : 'var(--bg-input)',
                      color: presente ? '#fff' : 'var(--text-secondary)',
                      boxShadow: presente ? '0 0 12px rgba(34,197,94,0.3)' : 'none',
                      transition: 'all 0.15s',
                    }}>
                    ✓ PRESENTE
                  </button>
                  <button type="button" onClick={() => definir(a.id, 'F')} title="Marcar falta"
                    style={{
                      padding: '7px 14px', borderRadius: 9, fontSize: '0.78rem', fontWeight: 800, cursor: 'pointer',
                      border: st === 'F' ? '1px solid rgba(239,68,68,0.6)' : '1px solid var(--border)',
                      background: st === 'F' ? 'rgba(239,68,68,0.16)' : 'var(--bg-input)',
                      color: st === 'F' ? '#f87171' : 'var(--text-secondary)',
                      transition: 'all 0.15s',
                    }}>
                    FALTA
                  </button>
                  {justif && (
                    <span style={{ padding: '7px 12px', borderRadius: 9, fontSize: '0.75rem', fontWeight: 800, background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.45)', color: '#eab308' }}>
                      JUSTIFICADA
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Salvar */}
      {!loading && alunos.length > 0 && treinoExistente && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {confirmar ? (
            <>
              <div style={{ fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                {total} alunos · <span style={{ color: '#22c55e' }}>{presentes} presentes</span> · <span style={{ color: '#ef4444' }}>{faltas} faltas</span>{justificadas > 0 ? <> · <span style={{ color: '#eab308' }}>{justificadas} justificadas</span></> : null} — confirmar?
              </div>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button onClick={() => setConfirmar(false)} style={{ ...inputStyle, cursor: 'pointer', fontWeight: 700 }}>Cancelar</button>
                <button onClick={salvar} disabled={saving}
                  style={{ padding: '9px 22px', borderRadius: 9, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 800, fontSize: '0.86rem', cursor: saving ? 'wait' : 'pointer', boxShadow: '0 0 16px rgba(255,146,0,0.3)' }}>
                  {saving ? 'Salvando...' : 'Salvar chamada'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {salvoEm ? 'Chamada já registrada para esta data — salvar novamente atualiza os registros.' : 'Todos começam como falta; salve para registrar a chamada do dia.'}
              </div>
              <button onClick={() => setConfirmar(true)} disabled={saving}
                style={{ marginLeft: 'auto', padding: '10px 26px', borderRadius: 9, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer', boxShadow: '0 0 16px rgba(255,146,0,0.3)' }}>
                Salvar chamada
              </button>
            </>
          )}
        </div>
      )}

      {msg && (
        <div style={{
          background: msg.startsWith('✓') ? 'rgba(34,197,94,0.09)' : 'rgba(239,68,68,0.09)',
          border: `1px solid ${msg.startsWith('✓') ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
          color: msg.startsWith('✓') ? '#86efac' : '#fca5a5',
          borderRadius: 12, padding: '11px 15px', fontSize: '0.85rem', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {msg.startsWith('✓') ? <IconCheck size={15} /> : <IconWarn size={15} />}{msg}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
