// Mural de avisos: cartazes e comunicados criados pelos admins.
// - GET: lista todos os avisos (aluno e painel). Observação de núcleo é apenas
//   organizacional (exibida como etiqueta); avisos são do grupo inteiro.
// - POST: cria aviso — exige sessão de painel (owner/admin geral/admin de núcleo).
// - DELETE: remove aviso — owner/admin geral podem qualquer um; admin de núcleo
//   só os que ele mesmo criou.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appendAudit } from '@/lib/audit';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, type PanelAccount } from '@/lib/panelCredentials';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const KEY = 'config/mural.json';

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

async function loadMural(): Promise<MuralItem[]> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(KEY, 30);
    if (!data?.signedUrl) return [];
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveMural(items: MuralItem[]): Promise<void> {
  const blob = new Blob([JSON.stringify(items)], { type: 'application/json' });
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(KEY, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw new Error(error.message);
}

/** Resolve a sessão do painel + conta correspondente. */
async function resolveAdmin(req: Request) {
  const sess = readPanelSession(req);
  if (!sess) return null;
  const creds = await loadCreds();
  const acc: PanelAccount | undefined = creds[sess.u];
  if (!acc) return null;
  return { login: sess.u, acc, isGeral: accIsGeral(acc), displayName: acc.nome || sess.u };
}

// GET /api/mural — lista os avisos (aluno e painel)
export async function GET() {
  const items = await loadMural();
  return NextResponse.json({ items });
}

// POST /api/mural — cria aviso/cartaz
export async function POST(req: NextRequest) {
  try {
    const admin = await resolveAdmin(req);
    if (!admin) return NextResponse.json({ error: 'Sessão do painel expirada. Entre novamente.' }, { status: 401 });

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 });

    const tipo: MuralItem['tipo'] = body.tipo === 'cartaz' ? 'cartaz' : 'aviso';
    const titulo = String(body.titulo || '').trim();
    const texto = String(body.texto || '').trim();
    const imagemPath = String(body.imagem_path || '').trim();
    const nucleo = String(body.nucleo || '').trim();

    if (!titulo) return NextResponse.json({ error: 'Informe um título.' }, { status: 400 });
    if (tipo === 'cartaz' && !imagemPath) return NextResponse.json({ error: 'Selecione a imagem do cartaz.' }, { status: 400 });
    if (tipo === 'aviso' && !texto) return NextResponse.json({ error: 'Escreva o texto do aviso.' }, { status: 400 });

    const items = await loadMural();
    const novo: MuralItem = {
      id: `mural_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tipo,
      titulo,
      texto: texto || undefined,
      imagem_path: imagemPath || undefined,
      autor: admin.displayName,
      autor_login: admin.login,
      nucleo: nucleo || undefined,
      created_at: new Date().toISOString(),
    };
    items.unshift(novo);
    await saveMural(items.slice(0, 300));

    await appendAudit({
      actor: admin.login,
      actor_type: 'admin',
      action: 'mural_criar',
      target_id: novo.id,
      target_name: titulo,
      details: { tipo, nucleo: nucleo || null, com_imagem: !!imagemPath },
    });

    return NextResponse.json({ ok: true, item: novo });
  } catch (e) {
    console.error('mural POST error:', e);
    return NextResponse.json({ error: 'Erro ao salvar o aviso.' }, { status: 500 });
  }
}

// DELETE /api/mural?id=... — owner/geral qualquer; núcleo só o próprio
export async function DELETE(req: NextRequest) {
  const admin = await resolveAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Sessão do painel expirada. Entre novamente.' }, { status: 401 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'ID obrigatório.' }, { status: 400 });

  const items = await loadMural();
  const alvo = items.find(i => i.id === id);
  if (!alvo) return NextResponse.json({ error: 'Aviso não encontrado.' }, { status: 404 });

  if (!admin.isGeral && alvo.autor_login !== admin.login) {
    return NextResponse.json({ error: 'Você só pode remover avisos publicados por você.' }, { status: 403 });
  }

  // Remove a imagem do storage se existir
  if (alvo.imagem_path) {
    try { await supabaseAdmin.storage.from(BUCKET).remove([alvo.imagem_path]); } catch {}
  }

  const restantes = items.filter(i => i.id !== id);
  await saveMural(restantes);

  await appendAudit({
    actor: admin.login,
    actor_type: 'admin',
    action: 'mural_excluir',
    target_id: id,
    target_name: alvo.titulo,
  });

  return NextResponse.json({ ok: true });
}
