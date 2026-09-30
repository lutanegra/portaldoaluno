'use client';

/**
 * MuralAdmin — aba do painel para publicar avisos e cartazes no mural do aluno.
 * - Aviso: título + texto.
 * - Cartaz: título + imagem (upload direto para o bucket privado).
 * Qualquer admin publica; owner/admin geral removem qualquer item,
 * admin de núcleo remove apenas o que publicou (reforçado no servidor).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type MuralItem = {
  id: string;
  tipo: 'cartaz' | 'aviso';
  titulo: string;
  texto?: string;
  imagem_path?: string;
  autor: string;
  autor_login: string;
  nucleo?: string;
  created_at: string;
};

export default function MuralAdmin({ nucleos }: { nucleos: { nome: string }[] }) {
  const [items, setItems] = useState<MuralItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<'aviso' | 'cartaz'>('aviso');
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [nucleo, setNucleo] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'cartaz' | 'aviso'>('todos');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/mural').then(r => r.json());
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch { /* mantém lista vazia */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onFile = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : '');
  };

  const publicar = async () => {
    setErr(''); setMsg('');
    if (!titulo.trim()) { setErr('Dê um título ao aviso.'); return; }
    if (tipo === 'cartaz' && !file) { setErr('Selecione a imagem do cartaz.'); return; }
    if (tipo === 'aviso' && !texto.trim()) { setErr('Escreva o texto do aviso.'); return; }
    setSaving(true);
    try {
      let imagemPath = '';
      if (tipo === 'cartaz' && file) {
        const fd = new FormData();
        fd.append('file', file);
        const up = await fetch('/api/mural/upload', { method: 'POST', body: fd });
        const upJson = await up.json().catch(() => ({}));
        if (!up.ok) throw new Error(upJson.error || 'Falha no envio da imagem.');
        imagemPath = upJson.path;
      }
      const res = await fetch('/api/mural', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo, titulo: titulo.trim(), texto: texto.trim(), imagem_path: imagemPath, nucleo: nucleo.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao publicar.');
      setMsg(tipo === 'cartaz' ? 'Cartaz publicado no mural!' : 'Aviso publicado no mural!');
      setTitulo(''); setTexto(''); setNucleo(''); onFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao publicar.');
    }
    setSaving(false);
  };

  const excluir = async (id: string, tituloItem: string) => {
    if (!window.confirm(`Remover "${tituloItem}" do mural?`)) return;
    const res = await fetch(`/api/mural?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(json.error || 'Erro ao remover.'); return; }
    setMsg('Item removido do mural.');
    await load();
  };

  const filtrados = items.filter(i => filtro === 'todos' || i.tipo === filtro);

  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: '#fff', border: '1px solid #d4d4d8',
    borderRadius: 8, padding: '9px 12px', fontSize: '0.88rem', color: '#18181b',
  };
  const lbl: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: '#52525b', marginBottom: 4, display: 'block' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>📌 Mural do Aluno</h2>
          <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#71717a' }}>
            Avisos em texto e cartazes em imagem aparecem na tela inicial de todos os alunos.
          </p>
        </div>
        <button onClick={load} style={{ border: '1px solid #d4d4d8', background: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>↻ Atualizar</button>
      </div>

      {(msg || err) && (
        <div style={{
          background: err ? '#fef2f2' : '#f0fdf4', border: `1px solid ${err ? '#fecaca' : '#bbf7d0'}`,
          color: err ? '#991b1b' : '#166534', borderRadius: 10, padding: '10px 14px', fontSize: '0.83rem', fontWeight: 600,
        }}>
          {err || msg}
        </div>
      )}

      {/* Formulário */}
      <div style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, padding: 16 }}>
        {/* Alternador de tipo */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {([['aviso', '📝 Aviso em texto'], ['cartaz', '🖼️ Cartaz (imagem)']] as const).map(([t, label]) => (
            <button key={t} onClick={() => { setTipo(t); setErr(''); }}
              style={{
                flex: 1, padding: '10px 8px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem',
                border: tipo === t ? '2px solid #FF9200' : '1px solid #e4e4e7',
                background: tipo === t ? 'rgba(255,146,0,0.10)' : '#fafafa',
                color: tipo === t ? '#b45309' : '#71717a',
              }}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>Título *</label>
            <input style={inp} value={titulo} onChange={e => setTitulo(e.target.value)}
              placeholder={tipo === 'cartaz' ? 'Ex.: Roda de samba no núcleo central' : 'Ex.: Não haverá treino sábado'} maxLength={120} />
          </div>

          {tipo === 'aviso' ? (
            <div>
              <label style={lbl}>Texto do aviso *</label>
              <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} value={texto} onChange={e => setTexto(e.target.value)}
                placeholder="Escreva o comunicado que o aluno vai ler no app..." maxLength={1200} />
            </div>
          ) : (
            <div>
              <label style={lbl}>Imagem do cartaz *</label>
              <input ref={fileRef} type="file" accept="image/*" style={inp} onChange={e => onFile(e.target.files?.[0] || null)} />
              {preview && (
                <div style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden', border: '1px solid #e4e4e7', maxHeight: 240, display: 'flex', justifyContent: 'center', background: '#fafafa' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Prévia do cartaz" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }} />
                </div>
              )}
              <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: '#a1a1aa' }}>PNG ou JPG, até 8 MB. A imagem é publicada exatamente como enviada.</p>
            </div>
          )}

          <div style={{ maxWidth: 320 }}>
            <label style={lbl}>Etiqueta de núcleo (opcional)</label>
            <select style={inp} value={nucleo} onChange={e => setNucleo(e.target.value)}>
              <option value="">Todos os núcleos</option>
              {nucleos.map(n => <option key={n.nome} value={n.nome}>{n.nome}</option>)}
            </select>
            <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: '#a1a1aa' }}>
              O aviso é exibido para todos; a etiqueta indica o núcleo relacionado.
            </p>
          </div>

          <button onClick={publicar} disabled={saving}
            style={{
              alignSelf: 'flex-start', background: saving ? '#a1a1aa' : 'linear-gradient(135deg,#FF9200,#d97706)', color: '#fff',
              border: 'none', borderRadius: 10, padding: '11px 22px', fontWeight: 800, fontSize: '0.88rem', cursor: saving ? 'wait' : 'pointer',
            }}>
            {saving ? 'Publicando...' : 'Publicar no mural'}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 6 }}>
        {([['todos', `Todos (${items.length})`], ['aviso', `Avisos (${items.filter(i => i.tipo === 'aviso').length})`], ['cartaz', `Cartazes (${items.filter(i => i.tipo === 'cartaz').length})`]] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFiltro(f)}
            style={{
              border: '1px solid ' + (filtro === f ? '#FF9200' : '#e4e4e7'), background: filtro === f ? 'rgba(255,146,0,0.10)' : '#fff',
              color: filtro === f ? '#b45309' : '#71717a', borderRadius: 999, padding: '5px 14px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
            }}>{label}</button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#71717a', fontSize: '0.85rem', padding: 24 }}>Carregando mural...</div>
      ) : filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, border: '2px dashed #e4e4e7', borderRadius: 14, color: '#71717a', fontSize: '0.85rem' }}>
          Nenhum item no mural ainda. Publique o primeiro aviso acima.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtrados.map(item => (
            <div key={item.id} style={{ background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {item.tipo === 'cartaz' && item.imagem_path && (
                <MuralImage path={item.imagem_path} />
              )}
              <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ background: item.tipo === 'cartaz' ? 'rgba(255,146,0,0.12)' : 'rgba(59,130,246,0.10)', color: item.tipo === 'cartaz' ? '#b45309' : '#1d4ed8', borderRadius: 6, padding: '2px 8px', fontSize: '0.64rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {item.tipo === 'cartaz' ? 'Cartaz' : 'Aviso'}
                  </span>
                  {item.nucleo && (
                    <span style={{ background: '#f4f4f5', color: '#52525b', borderRadius: 6, padding: '2px 8px', fontSize: '0.64rem', fontWeight: 700 }}>🏢 {item.nucleo}</span>
                  )}
                </div>
                <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#18181b', lineHeight: 1.3 }}>{item.titulo}</div>
                {item.texto && <div style={{ fontSize: '0.8rem', color: '#3f3f46', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.texto}</div>}
                <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: '0.68rem', color: '#a1a1aa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span>{item.autor} · {new Date(item.created_at).toLocaleDateString('pt-BR')}</span>
                  <button onClick={() => excluir(item.id, item.titulo)}
                    style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 7, padding: '3px 10px', fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer' }}>
                    Remover
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Carrega a imagem assinada do bucket privado. */
function MuralImage({ path }: { path: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    fetch(`/api/mural/imagem?path=${encodeURIComponent(path)}`)
      .then(r => r.json())
      .then(d => { if (alive && d.url) setUrl(d.url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [path]);

  if (!url) return <div style={{ height: 140, background: '#f4f4f5' }} />;
  return (
    <div style={{ maxHeight: 260, overflow: 'hidden', display: 'flex', justifyContent: 'center', background: '#fafafa', borderBottom: '1px solid #e4e4e7' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" style={{ width: '100%', objectFit: 'cover', maxHeight: 260 }} />
    </div>
  );
}
