// Mural de avisos: cartazes e comunicados criados pelos admins.
// - GET: lista avisos. Aluno recebe ?nucleo=<nome> => avisos gerais (sem núcleo,
//   publicados por owner/admin geral) + avisos etiquetados com o seu núcleo.
//   Painel sem ?nucleo= recebe tudo (a filtragem de gestão é feita na tela).
// - POST: cria aviso — exige sessão de painel. Admin de núcleo só publica com
//   etiqueta de um dos núcleos que gerencia; owner/admin geral podem publicar
//   para todos (sem etiqueta) ou para qualquer núcleo.
// - PATCH: edita título/texto — owner/admin geral qualquer um; admin de núcleo
//   só o que ele mesmo criou.
// - DELETE: remove — mesmas regras do PATCH (reforçadas no servidor).
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
  updated_at?: string;
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

// GET /api/mural — painel recebe tudo; aluno com ?scope=aluno recebe os avisos
// gerais (owner/admin geral) + os etiquetados com o seu núcleo (?nucleo=).
export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const scope = params.get('scope') || '';
  const nucleoAluno = (params.get('nucleo') || '').trim();
  const items = await loadMural();
  if (scope !== 'aluno') return NextResponse.json({ items });

  // Credenciais carregadas uma vez: itens sem etiqueta só alcançam todos os
  // núcleos quando o autor é owner/admin geral.
  let creds: Record<string, PanelAccount> = {};
  try { creds = await loadCreds(); } catch {}
  const autorEhGeral = (login: string) => {
    const acc = creds[login];
    return !!acc && accIsGeral(acc);
  };

  const filtrados = items.filter(i => {
    if (!i.nucleo) return autorEhGeral(i.autor_login);
    return !!nucleoAluno && i.nucleo === nucleoAluno;
  });
  return NextResponse.json({ items: filtrados });
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

    // Admin de núcleo: precisa etiquetar um dos núcleos que gerencia
    const meusNucleos = Array.isArray(admin.acc.nucleos) ? admin.acc.nucleos.filter(Boolean) : [];
    if (!admin.isGeral) {
      if (!nucleo) {
        return NextResponse.json({ error: 'Como admin de núcleo, selecione para qual dos seus núcleos o aviso será exibido.' }, { status: 403 });
      }
      if (meusNucleos.length > 0 && !meusNucleos.includes(nucleo)) {
        return NextResponse.json({ error: 'Você só pode publicar para os núcleos que gerencia.' }, { status: 403 });
      }
    }

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

/** Owner/admin geral podem editar/remover qualquer item; admin de núcleo só o próprio. */
function podeGerenciar(admin: { isGeral: boolean; login: string }, item: MuralItem): boolean {
  if (admin.isGeral) return true;
  return item.autor_login === admin.login;
}

// PATCH /api/mural — edita título/texto/etiqueta de um item
export async function PATCH(req: NextRequest) {
  const admin = await resolveAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Sessão do painel expirada. Entre novamente.' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const id = body?.id ? String(body.id) : '';
  if (!id) return NextResponse.json({ error: 'ID obrigatório.' }, { status: 400 });

  const items = await loadMural();
  const alvo = items.find(i => i.id === id);
  if (!alvo) return NextResponse.json({ error: 'Aviso não encontrado.' }, { status: 404 });
  if (!podeGerenciar(admin, alvo)) {
    return NextResponse.json({ error: 'Você só pode editar avisos publicados por você.' }, { status: 403 });
  }

  const titulo = String(body.titulo ?? '').trim();
  const texto = String(body.texto ?? '').trim();
  const nucleo = String(body.nucleo ?? '').trim();
  if (!titulo) return NextResponse.json({ error: 'Informe um título.' }, { status: 400 });

  // Admin de núcleo não pode soltar a etiqueta nem apontar para núcleo estranho
  const meusNucleos = Array.isArray(admin.acc.nucleos) ? admin.acc.nucleos.filter(Boolean) : [];
  if (!admin.isGeral) {
    if (!nucleo) return NextResponse.json({ error: 'Selecione o núcleo do aviso.' }, { status: 403 });
    if (meusNucleos.length > 0 && !meusNucleos.includes(nucleo)) {
      return NextResponse.json({ error: 'Você só pode publicar para os núcleos que gerencia.' }, { status: 403 });
    }
  }

  alvo.titulo = titulo;
  alvo.texto = texto || undefined;
  if (admin.isGeral) {
    alvo.nucleo = nucleo || undefined;
  } else {
    alvo.nucleo = nucleo;
  }
  alvo.updated_at = new Date().toISOString();
  await saveMural(items);

  await appendAudit({
    actor: admin.login,
    actor_type: 'admin',
    action: 'mural_editar',
    target_id: id,
    target_name: titulo,
    details: { nucleo: alvo.nucleo || null },
  });

  return NextResponse.json({ ok: true, item: alvo });
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

  if (!podeGerenciar(admin, alvo)) {
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
