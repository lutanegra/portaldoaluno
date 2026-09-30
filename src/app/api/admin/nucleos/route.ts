import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  hashPassword,
  verifyPassword,
  defaultPasswordForSlug,
  sanitizeDiasTreino,
  pickColorForSlug,
  loadCreds,
  saveCreds,
  resolveUsername,
  normalizeCpfDigits,
  normalizeEmail,
  ensureSupabaseAuthUser,
  accNucleos,
  OWNER_KEY,
  type CredsMap,
} from '@/lib/panelCredentials';
import { appendAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Autentica a chamada de duas formas:
 * - Gestão (owner/admin): header/body com admin_username + admin_password (senha real).
 * - Compatibilidade: header x-admin-auth: "owner" | "geral" (usado por telas já logadas).
 * - Admin de núcleo: nucleo_login + nucleo_password (login, CPF ou e-mail).
 */
async function autenticar(
  req: NextRequest,
  body: Record<string, unknown>
): Promise<{ autorizado: boolean; owner: boolean; adminGeral: boolean; loginNucleo?: string; actor: string }> {
  const credsFor = async () => loadCreds();
  const explicitRaw = String(body.admin_username || req.headers.get('x-admin-username') || '').trim();
  const explicitPass = String(body.admin_password || req.headers.get('x-admin-password') || '');
  if (explicitRaw && explicitPass) {
    const creds = await credsFor();
    const explicitUser = resolveUsername(creds, explicitRaw);
    const user = explicitUser ? creds[explicitUser] : undefined;
    if (!user || !verifyPassword(explicitPass, user.password) || user.nucleo !== 'geral')
      return { autorizado: false, owner: false, adminGeral: false, actor: explicitRaw };
    return { autorizado: true, owner: explicitUser === OWNER_KEY, adminGeral: true, actor: explicitUser ?? '' };
  }
  // Compat: sessão já validada por login manda apenas a marcação
  const marcador = String(req.headers.get('x-admin-auth') || body.admin_auth || '').toLowerCase();
  if (marcador === 'owner') return { autorizado: true, owner: true, adminGeral: true, actor: 'owner' };
  if (marcador === 'geral' || marcador === 'admin') return { autorizado: true, owner: false, adminGeral: true, actor: 'admin-geral' };
  // Admin de núcleo: login + senha da própria conta, para editar o próprio núcleo
  const nucleoRaw = String(body.nucleo_login || '').trim();
  const nucleoPass = String(body.nucleo_password || '');
  if (nucleoRaw && nucleoPass) {
    const creds = await credsFor();
    const nucleoLogin = resolveUsername(creds, nucleoRaw);
    const user = nucleoLogin ? creds[nucleoLogin] : undefined;
    if (!user || !verifyPassword(nucleoPass, user.password) || user.nucleo === 'geral')
      return { autorizado: false, owner: false, adminGeral: false, actor: nucleoRaw };
    return { autorizado: true, owner: false, adminGeral: false, loginNucleo: user.nucleo, actor: nucleoLogin ?? '' };
  }
  return { autorizado: false, owner: false, adminGeral: false, actor: '' };
}

// GET /api/admin/nucleos - Lista de núcleos (tenants)
// Leitura pública com campos seguros (nome, endereço, dias, coordenadas) —
// o app do aluno precisa dela para escolher núcleo e fazer check-in.
// Nenhum dado de conta/admin é exposto aqui.
export async function GET(req: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const seguros = (data || []).map((n: Record<string, unknown>) => {
      const { admin_login, ...resto } = n as Record<string, unknown>;
      void admin_login;
      return resto;
    });

    return NextResponse.json({ nucleos: seguros });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/admin/nucleos - Create a new nucleo (tenant) - OWNER/ADMIN GERAL
// Campos: nome*, endereco*, cidade, estado, telefone, email, lat, lng,
//         dias_treino[], admin_login*, admin_senha (padrão = nome do núcleo),
//         admin_nome, admin_email, admin_cpf (opcionais)
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

    const creds = await loadCreds();
    if (creds[adminLogin]) {
      return NextResponse.json({ error: `O login "${adminLogin}" já está em uso.` }, { status: 400 });
    }

    const adminEmail = normalizeEmail(String(body.admin_email || ''));
    if (adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return NextResponse.json({ error: 'E-mail do admin inválido.' }, { status: 400 });
    }
    if (adminEmail && Object.values(creds).some(c => normalizeEmail(c.email || '') === adminEmail)) {
      return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta de acesso.' }, { status: 400 });
    }
    const adminCpf = normalizeCpfDigits(String(body.admin_cpf || ''));
    if (adminCpf && adminCpf.length !== 11) {
      return NextResponse.json({ error: 'CPF do admin deve ter 11 dígitos.' }, { status: 400 });
    }
    if (adminCpf && Object.values(creds).some(c => normalizeCpfDigits(c.cpf || '') === adminCpf)) {
      return NextResponse.json({ error: 'Este CPF já está vinculado a outra conta de acesso.' }, { status: 400 });
    }

    // Check if slug already exists
    const { data: existing } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'Já existe um núcleo com este nome.' }, { status: 409 });
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
      email: adminEmail || undefined,
      cpf: adminCpf || undefined,
      first_login: false,
    };
    await saveCreds(creds);
    if (adminEmail) await ensureSupabaseAuthUser(adminEmail, adminLogin, String(body.admin_nome || ''));

    await appendAudit({
      actor: auth.actor || 'admin-geral',
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

    // Remove as credenciais de todos os admins deste núcleo
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
      actor: auth.actor || 'admin-geral',
      actor_type: 'admin',
      action: 'nucleo_excluido',
      target_id: String(id),
      details: { slug: tenant?.slug, admin_login_removido: tenant?.admin_login || null },
    });

    if (tenant?.slug) {
      const creds = await loadCreds();
      const loginsDoNucleo = Object.keys(creds).filter(k => creds[k].nucleo === tenant.slug);
      if (loginsDoNucleo.length > 0) {
        for (const k of loginsDoNucleo) delete creds[k];
        await saveCreds(creds);
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

    // Admin de núcleo só pode editar núcleos que gerencia (principal + vinculados)
    if (!auth.owner && !auth.adminGeral && auth.loginNucleo) {
      const acc = auth.loginNucleo ? (await loadCreds())[auth.actor] : undefined;
      const gerenciados = accNucleos(acc);
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('id, slug')
        .eq('id', id)
        .maybeSingle();
      if (!tenant || !gerenciados.includes(String(tenant.slug))) {
        return NextResponse.json({ error: 'Você só pode editar núcleos que você gerencia.' }, { status: 403 });
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

    // Renomeou o núcleo? Propaga o novo slug para as contas de admin vinculadas
    // (campo principal e listas de núcleos adicionais).
    const oldSlug = typeof body.slug_anterior === 'string' ? body.slug_anterior : null;
    const newSlug = typeof updates.slug === 'string' ? updates.slug : null;
    if (oldSlug && newSlug && oldSlug !== newSlug) {
      const creds = await loadCreds();
      let mudou = false;
      for (const [k, c] of Object.entries(creds)) {
        if (c.nucleo === oldSlug) {
          const extras = Array.isArray(c.nucleos) ? c.nucleos.filter(s => s !== oldSlug) : undefined;
          creds[k] = { ...c, nucleo: newSlug, nucleos: extras };
          mudou = true;
        } else if (Array.isArray(c.nucleos) && c.nucleos.includes(oldSlug)) {
          const extras = c.nucleos.map(s => (s === oldSlug ? newSlug : s));
          creds[k] = { ...c, nucleos: extras };
          mudou = true;
        }
      }
      if (mudou) await saveCreds(creds);
    }

    await appendAudit({
      actor: auth.actor || 'admin-geral',
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
