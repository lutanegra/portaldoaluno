import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { hashPassword, verifyPassword, defaultPasswordForSlug, sanitizeDiasTreino, pickColorForSlug } from '@/lib/panelCredentials';
import { appendAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const CREDS_KEY = 'config/panel-credentials.json';

interface CredencialNucleo {
  nucleo: string;
  label: string;
  color: string;
  password: string;
  email?: string;
  nome?: string;
  first_login?: boolean;
}

type CredsMap = Record<string, CredencialNucleo>;

const OWNER_KEY = 'owner';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

async function loadCreds(): Promise<CredsMap> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(CREDS_KEY, 30);
    if (!data?.signedUrl) return {};
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

/**
 * Autentica a chamada de duas formas:
 * - Gestão (owner/admin): header/body com admin_username + admin_password (senha real).
 * - Compatibilidade: header x-admin-auth: "owner" | "geral" (usado por telas já logadas).
 */
async function autenticar(
  req: NextRequest,
  body: Record<string, unknown>
): Promise<{ autorizado: boolean; owner: boolean; adminGeral: boolean; loginNucleo?: string }> {
  const explicitUser = String(body.admin_username || req.headers.get('x-admin-username') || '').trim().toLowerCase();
  const explicitPass = String(body.admin_password || req.headers.get('x-admin-password') || '');
  if (explicitUser && explicitPass) {
    const creds = await loadCreds();
    const user = creds[explicitUser];
    if (!user || !verifyPassword(explicitPass, user.password) || user.nucleo !== 'geral')
      return { autorizado: false, owner: false, adminGeral: false };
    return { autorizado: true, owner: explicitUser === OWNER_KEY, adminGeral: true };
  }
  // Compat: sessão já validada por login manda apenas a marcação
  const marcador = String(req.headers.get('x-admin-auth') || body.admin_auth || '').toLowerCase();
  if (marcador === 'owner') return { autorizado: true, owner: true, adminGeral: true };
  if (marcador === 'geral' || marcador === 'admin') return { autorizado: true, owner: false, adminGeral: true };
  // Admin de núcleo: login + senha da própria conta, para editar o próprio núcleo
  const nucleoLogin = String(body.nucleo_login || '').trim().toLowerCase();
  const nucleoPass = String(body.nucleo_password || '');
  if (nucleoLogin && nucleoPass) {
    const creds = await loadCreds();
    const user = creds[nucleoLogin];
    if (!user || !verifyPassword(nucleoPass, user.password) || user.nucleo === 'geral')
      return { autorizado: false, owner: false, adminGeral: false };
    return { autorizado: true, owner: false, adminGeral: false, loginNucleo: user.nucleo };
  }
  return { autorizado: false, owner: false, adminGeral: false };
}

// GET /api/admin/nucleos - List all nucleos (tenants)
export async function GET(req: NextRequest) {
  try {
    const adminAuth = req.headers.get('x-admin-auth') || req.nextUrl.searchParams.get('auth') || '';
    if (!['geral', 'admin', 'owner'].includes(adminAuth.toLowerCase())) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 403 });
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ nucleos: data || [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/admin/nucleos - Create a new nucleo (tenant) - OWNER/ADMIN GERAL
// Campos: nome*, endereco, cidade, estado, telefone, email, lat, lng,
//         dias_treino[], admin_login*, admin_senha (padrão = nome do núcleo)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const auth = await autenticar(req, body);
    if (!auth.owner && !auth.adminGeral) {
      return NextResponse.json({
        error: 'Acesso negado. Apenas Owner ou Admin Geral podem criar núcleos.',
        owner_required: true
      }, { status: 403 });
    }

    const nome = String(body.nome || '').trim();
    if (nome.length < 2) {
      return NextResponse.json({ error: 'Nome do núcleo é obrigatório (mínimo 2 caracteres).' }, { status: 400 });
    }

    const adminLogin = String(body.admin_login || '').trim().toLowerCase();
    if (adminLogin.length < 3 || /\s/.test(adminLogin)) {
      return NextResponse.json({ error: 'Login do admin do núcleo é obrigatório (mín. 3 caracteres, sem espaços).' }, { status: 400 });
    }
    if (adminLogin === OWNER_KEY || adminLogin === 'admin') {
      return NextResponse.json({ error: 'Este login é reservado do sistema.' }, { status: 400 });
    }

    const endereco = String(body.endereco || '').trim();
    if (!endereco) {
      return NextResponse.json({ error: 'Endereço do núcleo é obrigatório.' }, { status: 400 });
    }

    const dias = sanitizeDiasTreino(body.dias_treino);
    if (dias.length === 0) {
      return NextResponse.json({ error: 'Selecione pelo menos um dia de treino.' }, { status: 400 });
    }

    const slug = slugify(nome);

    // Check if slug already exists
    const { data: existing } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: 'Já existe um núcleo com esse nome.' }, { status: 400 });
    }

    // Login do admin precisa estar livre
    const creds = await loadCreds();
    if (creds[adminLogin]) {
      return NextResponse.json({ error: `O login "${adminLogin}" já está em uso.` }, { status: 400 });
    }

    // Insert new tenant
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .insert({
        nome,
        slug,
        endereco,
        cidade: String(body.cidade || '').trim() || null,
        estado: String(body.estado || '').trim() || null,
        telefone: String(body.telefone || '').trim() || null,
        email: String(body.email || '').trim() || null,
        lat: body.lat ? parseFloat(String(body.lat)) : null,
        lng: body.lng ? parseFloat(String(body.lng)) : null,
        dias_treino: dias,
        admin_login: adminLogin,
        ativo: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Cria a credencial do admin deste núcleo (senha padrão = nome do núcleo)
    const senhaInformada = String(body.admin_senha || '').trim();
    creds[adminLogin] = {
      nucleo: slug,
      label: nome,
      color: pickColorForSlug(slug),
      password: hashPassword(senhaInformada || defaultPasswordForSlug(slug)),
      nome: String(body.admin_nome || '').trim(),
      first_login: false,
    };
    const blob = new Blob([JSON.stringify(creds)], { type: 'application/json' });
    await supabaseAdmin.storage.from(BUCKET).upload(CREDS_KEY, blob, { upsert: true });

    await appendAudit({
      actor: auth.owner ? 'owner' : 'admin-geral',
      actor_type: 'admin',
      action: 'nucleo_criado',
      target_id: String(data.id),
      target_name: nome,
      details: { slug, admin_login: adminLogin, senha_padrao: !senhaInformada, dias_treino: dias },
    });

    return NextResponse.json({
      success: true,
      nucleo: data,
      admin_login: adminLogin,
      senha_padrao_usada: !senhaInformada,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// DELETE /api/admin/nucleos - Delete a nucleo (tenant) - OWNER/ADMIN GERAL
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const auth = await autenticar(req, body);
    if (!auth.owner && !auth.adminGeral) {
      return NextResponse.json({
        error: 'Acesso negado. Apenas Owner ou Admin Geral podem excluir núcleos.',
        owner_required: true
      }, { status: 403 });
    }

    const id = body.id;
    if (!id) {
      return NextResponse.json({ error: 'ID do núcleo é obrigatório.' }, { status: 400 });
    }

    // Check if there are students in this nucleo
    const { count } = await supabaseAdmin
      .from('students')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', id);

    if (count && count > 0) {
      return NextResponse.json({
        error: `Não é possível excluir: existem ${count} aluno(s) vinculado(s) a este núcleo.`
      }, { status: 400 });
    }

    // Remove a credencial do admin deste núcleo
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('slug, admin_login')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from('tenants')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await appendAudit({
      actor: auth.owner ? 'owner' : 'admin-geral',
      actor_type: 'admin',
      action: 'nucleo_excluido',
      target_id: String(id),
      details: { slug: tenant?.slug, admin_login_removido: tenant?.admin_login || null },
    });

    if (tenant?.admin_login) {
      const creds = await loadCreds();
      if (creds[String(tenant.admin_login)]) {
        delete creds[String(tenant.admin_login)];
        const blob = new Blob([JSON.stringify(creds)], { type: 'application/json' });
        await supabaseAdmin.storage.from(BUCKET).upload(CREDS_KEY, blob, { upsert: true });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// PATCH /api/admin/nucleos - Update a nucleo (tenant)
// Owner/Admin Geral: qualquer campo. Admin do núcleo: apenas o próprio núcleo
// (nome, endereço, cidade, estado, telefone, email, lat, lng, dias_treino).
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const auth = await autenticar(req, body);
    if (!auth.autorizado) {
      return NextResponse.json({
        error: 'Acesso negado. Informe credenciais de Owner, Admin Geral ou do admin do núcleo.',
        owner_required: true
      }, { status: 403 });
    }

    const id = body.id;
    if (!id) {
      return NextResponse.json({ error: 'ID do núcleo é obrigatório.' }, { status: 400 });
    }

    // Admin de núcleo só pode editar o próprio núcleo
    if (!auth.owner && !auth.adminGeral && auth.loginNucleo) {
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('id, slug')
        .eq('id', id)
        .maybeSingle();
      if (!tenant || tenant.slug !== auth.loginNucleo) {
        return NextResponse.json({ error: 'Você só pode editar o seu próprio núcleo.' }, { status: 403 });
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.nome !== undefined) {
      const nome = String(body.nome).trim();
      if (nome.length < 2) return NextResponse.json({ error: 'Nome inválido.' }, { status: 400 });
      updates.nome = nome;
      updates.slug = slugify(nome);
    }
    if (body.endereco !== undefined) updates.endereco = String(body.endereco).trim() || null;
    if (body.cidade !== undefined) updates.cidade = String(body.cidade).trim() || null;
    if (body.estado !== undefined) updates.estado = String(body.estado).trim() || null;
    if (body.telefone !== undefined) updates.telefone = String(body.telefone).trim() || null;
    if (body.email !== undefined) updates.email = String(body.email).trim() || null;
    if (body.lat !== undefined) updates.lat = body.lat ? parseFloat(String(body.lat)) : null;
    if (body.lng !== undefined) updates.lng = body.lng ? parseFloat(String(body.lng)) : null;
    if (body.dias_treino !== undefined) {
      const dias = sanitizeDiasTreino(body.dias_treino);
      if (dias.length === 0) return NextResponse.json({ error: 'Selecione pelo menos um dia de treino.' }, { status: 400 });
      updates.dias_treino = dias;
    }
    if ((body.ativo !== undefined) && (auth.owner || auth.adminGeral)) updates.ativo = body.ativo;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo para atualizar.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('tenants')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await appendAudit({
      actor: auth.owner ? 'owner' : 'admin-geral',
      actor_type: 'admin',
      action: 'nucleo_atualizado',
      target_id: String(id),
      target_name: String(data.nome || ''),
      details: { campos: Object.keys(updates) },
    });

    return NextResponse.json({ success: true, nucleo: data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
