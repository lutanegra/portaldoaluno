'use client';

/**
 * MuralAdmin — aba do painel para publicar avisos e cartazes no mural do aluno.
 * - Aviso: título + texto. Cartaz: título + imagem (upload para o bucket privado).
 * - Alvo: "Todos os núcleos" (só owner/admin geral) ou múltiplos núcleos.
 *   Admin de núcleo publica exclusivamente para os núcleos que gerencia.
 * - Edições: owner/admin geral gerenciam qualquer item; admin de núcleo só os
 *   próprios (também reforçado no servidor).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBell, IconImage, IconMapPin, IconPencil, IconTrash, IconRefresh, IconWarn, IconUser } from '@/components/icons';

type MuralItem = {
  id: string;
  tipo: 'cartaz' | 'aviso';
  titulo: string;
  texto?: string;
  imagem_path?: string;
  autor: string;
  autor_login: string;
  autor_nome?: string;
  nucleo?: string;       // legado (nome bruto gravado antes dos slugs)
  nucleo_legado?: string;
  nucleos?: string[];    // slugs resolvidos pelo servidor
  nucleos_nomes?: string[];
  created_at: string;
  updated_at?: string;
};

type MeInfo = { username: string; display_name?: string; nome?: string; is_owner: boolean; role?: string; nucleos?: string[]; nucleo?: string };

export default function MuralAdmin({ nucleos }: { nucleos: { nome: string; slug?: string }[] }) {
  const [items, setItems] = useState<MuralItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<'aviso' | 'cartaz'>('aviso');
  const [titulo, setTitulo] = useState('');
  const [texto, setTexto] = useState('');
  const [alvos, setAlvos] = useState<string[]>([]); // slugs selecionados
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [filtro, setFiltro] = useState<'todos' | 'cartaz' | 'aviso'>('todos');
  const [me, setMe] = useState<MeInfo | null>(null);
  const [notificar, setNotificar] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // Estado de edição (somente título/texto/etiquetas; a imagem do cartaz não muda)
  const [editId, setEditId] = useState('');
  const [editTitulo, setEditTitulo] = useState('');
  const [editTexto, setEditTexto] = useState('');
  const [editAlvos, setEditAlvos] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  // Estado do formulário de confirmação de remoção
  const [removeItem, setRemoveItem] = useState<MuralItem | null>(null);
  const [removeConfirm, setRemoveConfirm] = useState('');
  const [removeSending, setRemoveSending] = useState(false);

  const ehGeral = !!me && (me.is_owner || me.role === 'owner' || me.role === 'admin_geral');

  // Núcleos que esta conta pode etiquetar (slugs; fallback para nome quando o
  // seletor da página não trouxer slug — matching por nome no servidor).
  const meusSlugs: string[] = Array.isArray(me?.nucleos) && me!.nucleos!.length > 0
    ? me!.nucleos!
    : (me?.nucleo ? [me.nucleo] : []);
  const nucleosExibiveis = ehGeral
    ? nucleos
    : nucleos.filter(n => {
        const s = (n.slug || n.nome).toLowerCase();
        return meusSlugs.some(m => String(m).toLowerCase() === s);
      });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/mural', { cache: 'no-store' }).then(r => r.json());
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch { /* mantém lista vazia */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    fetch('/api/admin/panel-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'me' }) })
      .then(r => r.json())
      .then(d => { if (d.authenticated) setMe(d); })
      .catch(() => {});
  }, [load]);

  const onFile = (f: File | null) => {
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : '');
  };

  const publicar = async () => {
    setErr(''); setMsg('');
    if (!titulo.trim()) { setErr('Dê um título ao aviso.'); return; }
    if (tipo === 'cartaz' && !file) { setErr('Selecione a imagem do cartaz.'); return; }
    if (tipo === 'aviso' && !texto.trim()) { setErr('Escreva o texto do aviso.'); return; }
    if (!ehGeral && alvos.length === 0) { setErr('Selecione pelo menos um dos seus núcleos.'); return; }
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
        body: JSON.stringify({ tipo, titulo: titulo.trim(), texto: texto.trim(), imagem_path: imagemPath, nucleos: alvos, notificar }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao publicar.');
      const n = json.notificacoes;
      setMsg(
        (tipo === 'cartaz' ? 'Cartaz publicado no mural!' : 'Aviso publicado no mural!') +
        (n ? ` Notificações: ${n.criadas} criada(s), ${n.pushesOk} push enviado(s).` : ''),
      );
      setTitulo(''); setTexto(''); setAlvos([]); onFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao publicar.');
    }
    setSaving(false);
  };

  const abrirEdicao = (item: MuralItem) => {
    setEditId(item.id);
    setEditTitulo(item.titulo);
    setEditTexto(item.texto || '');
    // Etiquetas atuais do item; itens legados "para todos" começam sem seleção
    setEditAlvos(Array.isArray(item.nucleos) ? item.nucleos : []);
    setMsg(''); setErr('');
  };

  const salvarEdicao = async () => {
    if (!editId) return;
    setErr(''); setMsg('');
    setEditSaving(true);
    try {
      const res = await fetch('/api/mural', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, titulo: editTitulo.trim(), texto: editTexto.trim(), nucleos: editAlvos }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao salvar a edição.');
      setMsg('Aviso atualizado.');
      setEditId('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao salvar a edição.');
    }
    setEditSaving(false);
  };

  const abrirRemocao = (item: MuralItem) => {
    setRemoveItem(item);
    setRemoveConfirm('');
    setMsg(''); setErr('');
  };

  const confirmarRemocao = async () => {
    if (!removeItem) return;
    if (removeConfirm.trim() !== removeItem.titulo.trim()) return;
    setRemoveSending(true);
    try {
      const res = await fetch(`/api/mural?id=${encodeURIComponent(removeItem.id)}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Erro ao remover.');
      setMsg('Item removido do mural.');
      setRemoveItem(null);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erro ao remover.');
    }
    setRemoveSending(false);
  };

  const podeGerenciar = (item: MuralItem) => ehGeral || item.autor_login === me?.username;

  const filtrados = items.filter(i => filtro === 'todos' || i.tipo === filtro);

  const inp: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, padding: '10px 12px', fontSize: '0.88rem', color: '#f5f5f4', outline: 'none',
  };
  const lbl: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: '#a3a3a3', marginBottom: 4, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' };

  // Alternador reutilizável de núcleos (checkboxes estilizados)
  const seletorNucleos = (selecionados: string[], setSel: (v: string[]) => void) => (
    <div>
      <label style={lbl}>Exibir para</label>
      {ehGeral ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8, cursor: 'pointer', fontSize: '0.85rem', color: '#f5f5f4' }}>
          <input
            type="checkbox"
            checked={selecionados.length === 0}
            onChange={() => setSel([])}
            style={{ width: 16, height: 16, accentColor: '#FF9200' }}
          />
          Todos os núcleos (sem etiqueta)
        </label>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {nucleosExibiveis.map(n => {
          const slug = (n.slug || n.nome).toLowerCase();
          const on = selecionados.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(on ? selecionados.filter(x => x !== slug) : [...selecionados, slug])}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontWeight: 700, fontSize: '0.76rem',
                padding: '7px 13px', borderRadius: 20,
                border: on ? '1.5px solid rgba(255,146,0,0.65)' : '1px solid rgba(255,255,255,0.12)',
                background: on ? 'rgba(255,146,0,0.14)' : 'rgba(255,255,255,0.04)',
                color: on ? '#FF9200' : '#a3a3a3',
                boxShadow: on ? '0 0 12px rgba(255,146,0,0.12)' : 'none',
              }}
            >
              <IconMapPin size={12} /> {n.nome}
            </button>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: '#6b6b6b' }}>
        {ehGeral
          ? 'Sem núcleo selecionado, o aviso aparece para todos os alunos do app. Etiquete um ou mais núcleos para restringir.'
          : 'Escolha um ou mais dos núcleos que você gerencia — só os alunos deles verão o aviso.'}
      </p>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 10, cursor: 'pointer', fontSize: '0.82rem', color: '#f5f5f4' }}>
        <input
          type="checkbox"
          checked={notificar}
          onChange={e => setNotificar(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: '#FF9200' }}
        />
        Notificar alunos e responsáveis (push)
      </label>
    </div>
  );

  const rotulosAlvos = (item: MuralItem): string[] => {
    if (Array.isArray(item.nucleos_nomes) && item.nucleos_nomes.length > 0) return item.nucleos_nomes;
    if (item.nucleo_legado) return [item.nucleo_legado];
    return [];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Cabeçalho */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12, background: 'radial-gradient(circle at 32% 26%, rgba(255,146,0,0.28), rgba(255,146,0,0.08))', border: '1px solid rgba(255,146,0,0.3)', color: '#FF9200', boxShadow: '0 0 16px rgba(255,146,0,0.16)' }}>
            <IconBell size={19} />
          </span>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f5f5f4' }}>Mural do Aluno</h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#8f8f8f' }}>
              Avisos e cartazes aparecem na tela inicial do app do aluno.
            </p>
          </div>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.05)', borderRadius: 9, padding: '8px 14px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: '#e5e5e5' }}>
          <IconRefresh size={14} /> Atualizar
        </button>
      </div>

      {(msg || err) && (
        <div style={{
          background: err ? 'rgba(220,38,38,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${err ? 'rgba(220,38,38,0.4)' : 'rgba(34,197,94,0.4)'}`,
          color: err ? '#fca5a5' : '#86efac', borderRadius: 10, padding: '10px 14px', fontSize: '0.83rem', fontWeight: 600,
        }}>
          {err || msg}
        </div>
      )}

      {/* Formulário */}
      <div style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: 16 }}>
        {/* Alternador de tipo */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {([['aviso', 'Aviso em texto'], ['cartaz', 'Cartaz (imagem)']] as const).map(([tp, label]) => {
            const Icon = tp === 'aviso' ? IconBell : IconImage;
            const ativo = tipo === tp;
            return (
              <button key={tp} onClick={() => { setTipo(tp); setErr(''); }}
                style={{
                  flex: 1, padding: '10px 8px', borderRadius: 11, cursor: 'pointer', fontWeight: 700, fontSize: '0.82rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  border: ativo ? '1.5px solid rgba(255,146,0,0.65)' : '1px solid rgba(255,255,255,0.1)',
                  background: ativo ? 'rgba(255,146,0,0.12)' : 'rgba(255,255,255,0.04)',
                  color: ativo ? '#FF9200' : '#a3a3a3',
                  boxShadow: ativo ? '0 0 14px rgba(255,146,0,0.12)' : 'none',
                }}>
                <Icon size={15} /> {label}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={lbl}>Título</label>
            <input style={inp} value={titulo} onChange={e => setTitulo(e.target.value)}
              placeholder={tipo === 'cartaz' ? 'Ex.: Roda de samba no núcleo central' : 'Ex.: Não haverá treino sábado'} maxLength={120} />
          </div>

          {tipo === 'aviso' ? (
            <div>
              <label style={lbl}>Texto do aviso</label>
              <textarea style={{ ...inp, minHeight: 90, resize: 'vertical' }} value={texto} onChange={e => setTexto(e.target.value)}
                placeholder="Escreva o comunicado que o aluno vai ler no app..." maxLength={1200} />
            </div>
          ) : (
            <div>
              <label style={lbl}>Imagem do cartaz</label>
              <input ref={fileRef} type="file" accept="image/*" style={{ ...inp, padding: '8px 10px' }} onChange={e => onFile(e.target.files?.[0] || null)} />
              {preview && (
                <div style={{ marginTop: 10, borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)', maxHeight: 240, display: 'flex', justifyContent: 'center', background: 'rgba(255,255,255,0.03)' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={preview} alt="Prévia do cartaz" style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }} />
                </div>
              )}
              <p style={{ margin: '6px 0 0', fontSize: '0.72rem', color: '#6b6b6b' }}>PNG ou JPG, até 8 MB. A imagem é publicada exatamente como enviada.</p>
            </div>
          )}

          {seletorNucleos(alvos, setAlvos)}

          <button onClick={publicar} disabled={saving}
            style={{
              alignSelf: 'flex-start', background: saving ? 'rgba(255,146,0,0.4)' : 'linear-gradient(135deg,#FF9200,#d97706)', color: '#fff',
              border: 'none', borderRadius: 11, padding: '11px 22px', fontWeight: 800, fontSize: '0.88rem', cursor: saving ? 'wait' : 'pointer',
              boxShadow: saving ? 'none' : '0 4px 18px rgba(255,146,0,0.25)',
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
              border: '1px solid ' + (filtro === f ? 'rgba(255,146,0,0.65)' : 'rgba(255,255,255,0.1)'), background: filtro === f ? 'rgba(255,146,0,0.12)' : 'rgba(255,255,255,0.04)',
              color: filtro === f ? '#FF9200' : '#a3a3a3', borderRadius: 999, padding: '6px 14px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer',
            }}>{label}</button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#8f8f8f', fontSize: '0.85rem', padding: 24 }}>Carregando mural...</div>
      ) : filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32, border: '1.5px dashed rgba(255,255,255,0.12)', borderRadius: 16, color: '#8f8f8f', fontSize: '0.85rem' }}>
          Nenhum item no mural ainda. Publique o primeiro aviso acima.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filtrados.map(item => {
            const gerenciavel = podeGerenciar(item);
            const rotulos = rotulosAlvos(item);
            return (
              <div key={item.id} style={{ background: 'linear-gradient(155deg, rgba(30,30,32,0.72), rgba(15,15,17,0.8))', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {item.tipo === 'cartaz' && item.imagem_path && (
                  <MuralImage path={item.imagem_path} />
                )}
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,146,0,0.1)', border: '1px solid rgba(255,146,0,0.28)', color: '#fdba74', borderRadius: 7, padding: '2.5px 8px', fontSize: '0.64rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {item.tipo === 'cartaz' ? <IconImage size={10} /> : <IconBell size={10} />}
                      {item.tipo === 'cartaz' ? 'Cartaz' : 'Aviso'}
                    </span>
                    {rotulos.length > 0 ? (
                      rotulos.map(r => (
                        <span key={r} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#a3a3a3', borderRadius: 7, padding: '2.5px 8px', fontSize: '0.64rem', fontWeight: 700 }}>
                          <IconMapPin size={10} /> {r}
                        </span>
                      ))
                    ) : (
                      <span style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#a3a3a3', borderRadius: 7, padding: '2.5px 8px', fontSize: '0.64rem', fontWeight: 700 }}>Todos os núcleos</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: '0.92rem', color: '#f5f5f4', lineHeight: 1.3 }}>{item.titulo}</div>
                  {item.texto && <div style={{ fontSize: '0.8rem', color: '#c9c9c9', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.texto}</div>}
                  <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.68rem', color: '#8f8f8f' }}>
                      <IconUser size={11} /> Publicado por <strong style={{ color: '#d4d4d4' }}>{item.autor_nome || item.autor || item.autor_login}</strong>
                      {' · '}{new Date(item.created_at).toLocaleDateString('pt-BR')}
                      {item.updated_at ? ` · editado ${new Date(item.updated_at).toLocaleDateString('pt-BR')}` : ''}
                    </span>
                    {gerenciavel && (
                      <span style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => abrirEdicao(item)} title="Editar aviso"
                          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,146,0,0.1)', color: '#FF9200', border: '1px solid rgba(255,146,0,0.3)', borderRadius: 8, padding: '5px 11px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                          <IconPencil size={12} /> Editar
                        </button>
                        <button onClick={() => abrirRemocao(item)} title="Remover do mural"
                          style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(220,38,38,0.1)', color: '#f87171', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '5px 11px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }}>
                          <IconTrash size={12} /> Remover
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de edição */}
      {editId && (
        <div role="dialog" aria-modal="true" aria-label="Editar aviso" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.66)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setEditId('')}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: 'linear-gradient(165deg, #1c1c1e, #101012)', border: '1px solid rgba(255,146,0,0.25)', borderRadius: 18, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.6)', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 10, background: 'rgba(255,146,0,0.12)', border: '1px solid rgba(255,146,0,0.3)', color: '#FF9200' }}>
                <IconPencil size={16} />
              </span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f5f5f4' }}>Editar publicação</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div>
                <label style={lbl}>Título</label>
                <input style={inp} value={editTitulo} onChange={e => setEditTitulo(e.target.value)} maxLength={120} />
              </div>
              <div>
                <label style={lbl}>Texto</label>
                <textarea style={{ ...inp, minHeight: 80, resize: 'vertical' }} value={editTexto} onChange={e => setEditTexto(e.target.value)} maxLength={1200} />
              </div>
              {seletorNucleos(editAlvos, setEditAlvos)}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => setEditId('')} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e5e5e5', borderRadius: 10, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button onClick={salvarEdicao} disabled={editSaving || !editTitulo.trim()}
                  style={{ background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: '0.82rem', cursor: editSaving ? 'wait' : 'pointer', opacity: editSaving || !editTitulo.trim() ? 0.6 : 1 }}>
                  {editSaving ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação de remoção */}
      {removeItem && (
        <div role="dialog" aria-modal="true" aria-label="Confirmar remoção" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(5px)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setRemoveItem(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'linear-gradient(165deg, #201313, #120c0c)', border: '1px solid rgba(220,38,38,0.4)', borderRadius: 18, padding: 20, boxShadow: '0 24px 70px rgba(0,0,0,0.65)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 11, background: 'rgba(220,38,38,0.14)', border: '1px solid rgba(220,38,38,0.4)', color: '#f87171', boxShadow: '0 0 14px rgba(220,38,38,0.2)' }}>
                <IconWarn size={17} />
              </span>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#fecaca' }}>Remover do mural</h3>
            </div>            <p style={{ margin: '0 0 14px', fontSize: '0.82rem', color: '#e7c9c9', lineHeight: 1.5 }}>
              Você está removendo <strong style={{ color: '#fecaca' }}>{removeItem.tipo === 'cartaz' ? 'o cartaz' : 'o aviso'}</strong> publicado por <strong style={{ color: '#fecaca' }}>{removeItem.autor_nome || removeItem.autor || removeItem.autor_login}</strong>.
              Para confirmar, digite o título exato da publicação abaixo.
            </p>
            <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
              <div style={{ fontSize: '0.66rem', fontWeight: 800, color: '#f8b4b4', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>Publicação</div>
              <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#fecaca' }}>{removeItem.titulo}</div>
            </div>
            <label style={lbl}>Digite o título para confirmar</label>
            <input
              style={{ ...inp, borderColor: 'rgba(220,38,38,0.35)' }}
              value={removeConfirm}
              onChange={e => setRemoveConfirm(e.target.value)}
              placeholder={removeItem.titulo}
              autoFocus
            />
            {removeConfirm.trim().length > 0 && removeConfirm.trim() !== removeItem.titulo.trim() && (
              <div style={{ marginTop: 7, fontSize: '0.74rem', color: '#fca5a5' }}>O texto não corresponde ao título.</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setRemoveItem(null)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e5e5e5', borderRadius: 10, padding: '9px 16px', fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={confirmarRemocao} disabled={removeSending || removeConfirm.trim() !== removeItem.titulo.trim()}
                style={{ background: removeConfirm.trim() !== removeItem.titulo.trim() ? 'rgba(220,38,38,0.35)' : 'linear-gradient(135deg,#dc2626,#b91c1c)', border: 'none', color: '#fff', borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: '0.82rem', cursor: removeSending ? 'wait' : 'pointer', opacity: removeSending ? 0.7 : 1 }}>
                {removeSending ? 'Removendo...' : 'Remover do mural'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
  if (!url) return <div style={{ aspectRatio: '16/9', background: 'rgba(255,255,255,0.04)' }} />;
  return (
    <div style={{ maxHeight: 260, overflow: 'hidden', display: 'flex', justifyContent: 'center', background: 'rgba(255,255,255,0.03)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" style={{ width: '100%', objectFit: 'cover' }} />
    </div>
  );
}
