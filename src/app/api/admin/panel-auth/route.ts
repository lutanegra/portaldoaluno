import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import {
  hashPassword,
  verifyPassword,
  defaultPasswordForSlug,
  pickColorForSlug,
} from '@/lib/panelCredentials';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);
const BUCKET = 'photos';
const CREDS_KEY = 'config/panel-credentials.json';
const TOKENS_KEY = 'config/reset-tokens.json';

type NucleoKey = string; // slug do núcleo no banco, ou 'geral'

interface Credential {
  nucleo: NucleoKey;
  label: string;
  color: string;
  password: string; // hash scrypt ("scrypt:salt:hash") ou legado em texto simples
  email?: string;
  createdBy?: string;
  nome?: string;
  first_login?: boolean; // true = deve trocar senha no primeiro acesso
}

type CredsMap = Record<string, Credential>;

interface ResetToken {
  cpf: string;
  token: string;
  expires: number; // timestamp ms
}
type TokensMap = Record<string, ResetToken>; // key = token

// Contas de gestão: fixas, criadas por seed (ver scripts/seed-panel-credentials.mjs).
const OWNER_KEY = 'owner';

// Credenciais padrão — usadas apenas quando o storage ainda não tem arquivo.
// As senhas definitivas foram definidas pelo Owner no seed inicial.
const DEFAULT_CREDS: CredsMap = {
  owner: { nucleo: 'geral', label: 'Owner (Desenvolvedor)', color: '#7c3aed', password: 'Mp27032013@', first_login: false },
  admin: { nucleo: 'geral', label: 'Admin Geral', color: '#1d4ed8', password: 'Scoralick0405@', first_login: false },
};

function normalizeCpf(s: string): string {
  return s.replace(/\D/g, '');
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase();
}

async function loadCreds(): Promise<CredsMap> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(CREDS_KEY, 30);
    if (!data?.signedUrl) return { ...DEFAULT_CREDS };
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_CREDS };
    const stored = await res.json();
    // Garante que owner/admin existam sempre
    return { ...DEFAULT_CREDS, ...stored };
  } catch { return { ...DEFAULT_CREDS }; }
}

async function saveCreds(map: CredsMap): Promise<void> {
  const blob = new Blob([JSON.stringify(map)], { type: 'application/json' });
  await supabase.storage.from(BUCKET).upload(CREDS_KEY, blob, { upsert: true });
}

async function loadTokens(): Promise<TokensMap> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(TOKENS_KEY, 30);
    if (!data?.signedUrl) return {};
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveTokens(map: TokensMap): Promise<void> {
  const blob = new Blob([JSON.stringify(map)], { type: 'application/json' });
  await supabase.storage.from(BUCKET).upload(TOKENS_KEY, blob, { upsert: true });
}

function isAdminGeral(creds: CredsMap, key: string): boolean {
  return !!creds[key] && creds[key].nucleo === 'geral';
}

/** Autentica o desafio de owner/admin para ações de gestão (sem senhas pela UI). */
function requireGestor(creds: CredsMap, username?: string, password?: string): { ok: boolean; key: string; owner: boolean } {
  const key = normalizeKey(username || '');
  const user = creds[key];
  if (!user || !password || !verifyPassword(password, user.password)) return { ok: false, key: '', owner: false };
  if (user.nucleo !== 'geral') return { ok: false, key: '', owner: false };
  return { ok: true, key, owner: key === OWNER_KEY };
}

/** Busca o núcleo pelo slug (ou nome) na tabela tenants. */
async function findTenantBySlugOrNome(term: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', term)
    .maybeSingle();
  if (data) return data;
  const { data: byName } = await supabase
    .from('tenants')
    .select('*')
    .ilike('nome', term)
    .maybeSingle();
  return byName || null;
}

/** Cria (ou retorna) a credencial de admin de núcleo para um tenant. */
async function credencialParaNucleo(
  creds: CredsMap,
  tenant: { id: string; nome: string; slug: string },
  senha?: string
): Promise<Credential> {
  const existing = creds[tenant.slug];
  if (existing) return existing;
  const nova: Credential = {
    nucleo: tenant.slug,
    label: tenant.nome,
    color: pickColorForSlug(tenant.slug),
    password: hashPassword(senha || defaultPasswordForSlug(tenant.slug)),
    first_login: false,
  };
  creds[tenant.slug] = nova;
  await saveCreds(creds);
  return nova;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  // ── LOGIN ──
  if (action === 'login') {
    const { username, password } = body;
    if (!username || !password)
      return NextResponse.json({ error: 'Usuário e senha obrigatórios.' }, { status: 400 });

    const creds = await loadCreds();
    const key = normalizeKey(username);
    const user = creds[key];
    if (!user || !verifyPassword(password, user.password))
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });

    const isGeral = user.nucleo === 'geral';
    const isOwner = key === OWNER_KEY;
    return NextResponse.json({
      ok: true,
      nucleo: user.nucleo,
      label: isOwner ? 'Owner' : user.label,
      color: user.color,
      nome: user.nome || '',
      isGeral,
      isOwner,
      first_login: user.first_login === true,
    });
  }

  // ── ALTERAR MINHA SENHA ──
  if (action === 'change-password') {
    const { username, current_password, new_password } = body;
    if (!username || !current_password || !new_password)
      return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
    if (String(new_password).length < 6)
      return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    const creds = await loadCreds();
    const key = normalizeKey(username);
    const user = creds[key];
    if (!user || !verifyPassword(current_password, user.password))
      return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 401 });
    creds[key] = { ...user, password: hashPassword(new_password), first_login: false };
    await saveCreds(creds);
    return NextResponse.json({ ok: true });
  }

  // ── SOLICITAR REDEFINIÇÃO DE SENHA (por login ou CPF) ──
  if (action === 'forgot-password') {
    const { username } = body;
    if (!username) return NextResponse.json({ error: 'Informe seu usuário de acesso.' }, { status: 400 });
    const term = normalizeCpf(username);
    const targetKey = term.length === 11 ? term : normalizeKey(username);

    const creds = await loadCreds();
    const user: Credential | undefined = creds[targetKey];
    if (!user) {
      return NextResponse.json({
        ok: true,
        no_email: true,
        message: 'Não encontramos uma conta com este usuário. Confira o login ou fale com o Owner/Admin Geral da organização.',
      });
    }
    const email = user.email || '';

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 30 * 60 * 1000; // 30 min
    const tokens = await loadTokens();
    for (const [k, v] of Object.entries(tokens)) {
      if (v.cpf === targetKey) delete tokens[k];
    }
    tokens[token] = { cpf: targetKey, token, expires };
    await saveTokens(tokens);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get('host')}`;
    const resetUrl = `${baseUrl}/nucleo/reset-senha?token=${token}`;

    if (email) {
      try {
        const { sendEmail, buildResetLinkHtml } = await import('@/lib/email');
        const { subject, html } = buildResetLinkHtml(user?.nome || '', resetUrl);
        const result = await sendEmail(email, subject, html);
        if (result.sent) {
          return NextResponse.json({ ok: true, message: `E-mail de redefinição enviado para ${email.replace(/(.{2}).+(@.+)/, '$1****$2')}.` });
        }
      } catch { /* segue para o link administrativo */ }
    }

    return NextResponse.json({
      ok: true,
      no_email: !email,
      message: !email
        ? 'Conta sem e-mail cadastrado. O Admin Geral pode usar o link abaixo para redefinir a senha.'
        : 'Falha ao enviar o e-mail. Tente novamente ou use o link abaixo.',
      reset_url: resetUrl,
      dev_token: token,
    });
  }

  // ── VALIDAR TOKEN DE RESET ──
  if (action === 'validate-reset-token') {
    const { token } = body;
    if (!token) return NextResponse.json({ error: 'Token obrigatório.' }, { status: 400 });
    const tokens = await loadTokens();
    const entry = tokens[token];
    if (!entry || entry.expires < Date.now())
      return NextResponse.json({ error: 'Token inválido ou expirado.' }, { status: 400 });
    const creds = await loadCreds();
    const user: Credential | undefined = creds[entry.cpf];
    return NextResponse.json({ ok: true, cpf: entry.cpf, nome: user?.nome || '', nucleo: user?.nucleo });  }

  // ── REDEFINIR SENHA VIA TOKEN ──
  if (action === 'reset-by-token') {
    const { token, new_password } = body;
    if (!token || !new_password)
      return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
    if (String(new_password).length < 6)
      return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });

    const tokens = await loadTokens();
    const entry = tokens[token];
    if (!entry || entry.expires < Date.now())
      return NextResponse.json({ error: 'Token inválido ou expirado.' }, { status: 400 });

    const creds = await loadCreds();
    if (!creds[entry.cpf])
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    creds[entry.cpf] = { ...creds[entry.cpf], password: hashPassword(new_password), first_login: false };
    await saveCreds(creds);

    delete tokens[token];
    await saveTokens(tokens);
    return NextResponse.json({ ok: true });
  }

  // ══ AÇÕES DE GESTÃO (owner/admin) ══

  // ── LISTAR CONTAS DO PAINEL ──
  if (action === 'list-users') {
    const g = requireGestor(await loadCreds(), body.admin_username, body.admin_password);
    if (!g.ok) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    const creds = await loadCreds();
    const list = await Promise.all(Object.entries(creds).map(async ([u, c]) => {
      let nucleoNome: string | null = null;
      if (c.nucleo !== 'geral') {
        const { data } = await supabase.from('tenants').select('nome').eq('slug', c.nucleo).maybeSingle();
        nucleoNome = data?.nome || c.nucleo;
      }
      return {
        username: u,
        label: c.label,
        nucleo: c.nucleo,
        nucleo_nome: nucleoNome,
        color: c.color,
        email: c.email || '',
        nome: c.nome || '',
        first_login: c.first_login || false,
        is_owner: u === OWNER_KEY,
      };
    }));
    return NextResponse.json(list);
  }

  // ── CRIAR ADMIN DE NÚCLEO (vinculado ao núcleo) ──
  if (action === 'create-user') {
    const g = requireGestor(await loadCreds(), body.admin_username, body.admin_password);
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem criar contas.' }, { status: 403 });

    const login = normalizeKey(body.login || '');
    if (login.length < 3)
      return NextResponse.json({ error: 'Login deve ter pelo menos 3 caracteres.' }, { status: 400 });
    if (/\s/.test(body.login?.trim() || ''))
      return NextResponse.json({ error: 'Login não pode conter espaços.' }, { status: 400 });

    const tenant = await findTenantBySlugOrNome(String(body.nucleo_key || body.nucleo_slug || ''));
    if (!tenant) return NextResponse.json({ error: 'Núcleo inválido.' }, { status: 400 });
    const slug = String(tenant.slug);

    const creds = await loadCreds();
    if (creds[login])
      return NextResponse.json({ error: `Login "${login}" já está em uso.` }, { status: 409 });
    if (login === OWNER_KEY || login === 'admin')
      return NextResponse.json({ error: 'Este login é reservado.' }, { status: 409 });

    const novaSenha = body.new_password ? String(body.new_password) : defaultPasswordForSlug(slug);
    if (novaSenha.length < 4)
      return NextResponse.json({ error: 'Senha deve ter pelo menos 4 caracteres.' }, { status: 400 });

    creds[login] = {
      nucleo: slug,
      label: String(tenant.nome),
      color: pickColorForSlug(slug),
      password: hashPassword(novaSenha),
      nome: body.nome?.trim() || '',
      email: body.email?.trim() || '',
      createdBy: g.key,
      first_login: false,
    };
    // Vincula o login do admin na própria tabela do núcleo
    await supabase.from('tenants').update({ admin_login: login }).eq('id', tenant.id);
    await saveCreds(creds);
    return NextResponse.json({ ok: true, login, nucleo: slug, senha_definida: !!body.new_password, message: 'Conta criada e vinculada ao núcleo!' });
  }

  // ── CRIAR ADMIN GERAL ADICIONAL ──
  if (action === 'create-geral') {
    const g = requireGestor(await loadCreds(), body.admin_username, body.admin_password);
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem criar contas.' }, { status: 403 });

    const newKey = normalizeKey(body.new_username || '');
    if (newKey.length < 3)
      return NextResponse.json({ error: 'Login deve ter pelo menos 3 caracteres.' }, { status: 400 });
    if (newKey === OWNER_KEY)
      return NextResponse.json({ error: 'Não é possível criar outro owner.' }, { status: 400 });

    const creds = await loadCreds();
    const totalGeral = Object.values(creds).filter(c => c.nucleo === 'geral').length;
    if (totalGeral >= 3)
      return NextResponse.json({ error: 'Limite de 3 administradores gerais atingido.' }, { status: 400 });
    if (creds[newKey])
      return NextResponse.json({ error: `Login "${newKey}" já existe.` }, { status: 409 });
    if (String(body.new_password || '').length < 6)
      return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, { status: 400 });

    creds[newKey] = {
      nucleo: 'geral',
      label: 'Admin Geral',
      color: '#1d4ed8',
      password: hashPassword(String(body.new_password)),
      nome: body.nome?.trim() || '',
      createdBy: g.key,
      first_login: false,
    };
    await saveCreds(creds);
    return NextResponse.json({ ok: true, username: newKey });
  }

  // ── REDEFINIR SENHA DE UM USUÁRIO (owner/admin; senha da UI opcional) ──
  if (action === 'reset-password') {
    const g = requireGestor(await loadCreds(), body.admin_username, body.admin_password);
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem redefinir senhas.' }, { status: 403 });
    const targetKey = normalizeKey(body.target_username || '');
    const creds = await loadCreds();
    if (!creds[targetKey])
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    if (String(body.new_password || '').length < 6)
      return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    creds[targetKey] = { ...creds[targetKey], password: hashPassword(String(body.new_password)), first_login: false };
    await saveCreds(creds);
    return NextResponse.json({ ok: true });
  }

  // ── REMOVER CONTA DO PAINEL ──
  if (action === 'delete-user') {
    const g = requireGestor(await loadCreds(), body.admin_username, body.admin_password);
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem remover contas.' }, { status: 403 });
    const targetKey = normalizeKey(body.target_username || '');
    const creds = await loadCreds();
    if (targetKey === OWNER_KEY || targetKey === 'admin')
      return NextResponse.json({ error: 'As contas Owner e Admin Geral não podem ser removidas.' }, { status: 400 });
    if (targetKey === g.key)
      return NextResponse.json({ error: 'Você não pode remover sua própria conta.' }, { status: 400 });
    if (!creds[targetKey])
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    // Remove o vínculo do núcleo, se houver
    const nucleoSlug = creds[targetKey].nucleo;
    delete creds[targetKey];
    await saveCreds(creds);
    if (nucleoSlug && nucleoSlug !== 'geral') {
      await supabase.from('tenants').update({ admin_login: null }).eq('slug', nucleoSlug).eq('admin_login', targetKey);
    }
    return NextResponse.json({ ok: true });
  }

  // ── DEFINIR/ALTERAR A SENHA DO ADMIN DE UM NÚCLEO (owner/admin) ──
  if (action === 'set-nucleo-password') {
    const g = requireGestor(await loadCreds(), body.admin_username, body.admin_password);
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem definir senhas de núcleo.' }, { status: 403 });
    const tenant = await findTenantBySlugOrNome(String(body.nucleo_key || ''));
    if (!tenant) return NextResponse.json({ error: 'Núcleo inválido.' }, { status: 400 });
    const slug = String(tenant.slug);
    const creds = await loadCreds();
    const loginAtual = String(tenant.admin_login || '') && creds[String(tenant.admin_login)]
      ? String(tenant.admin_login)
      : Object.keys(creds).find(k => creds[k].nucleo === slug);
    if (!loginAtual)
      return NextResponse.json({ error: 'Este núcleo ainda não tem conta de admin. Crie uma primeiro.' }, { status: 404 });
    const novaSenha = body.new_password ? String(body.new_password) : defaultPasswordForSlug(slug);
    if (novaSenha.length < 4)
      return NextResponse.json({ error: 'Senha deve ter pelo menos 4 caracteres.' }, { status: 400 });
    creds[loginAtual] = { ...creds[loginAtual], password: hashPassword(novaSenha), first_login: false };
    await saveCreds(creds);
    return NextResponse.json({ ok: true, login: loginAtual, message: body.new_password ? 'Senha atualizada.' : 'Senha restaurada para o padrão.' });
  }

  // ── LIMPEZA: REMOVER TODAS AS CONTAS EXCETO OWNER E ADMIN ──
  if (action === 'purge-non-gestores') {
    const g = requireGestor(await loadCreds(), body.admin_username, body.admin_password);
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem executar a limpeza.' }, { status: 403 });
    const creds = await loadCreds();
    let count = 0;
    for (const key of Object.keys(creds)) {
      if (key !== OWNER_KEY && key !== 'admin') {
        delete creds[key];
        count++;
      }
    }
    await saveCreds(creds);
    await supabase.from('tenants').update({ admin_login: null }).neq('admin_login', null as unknown as string);
    return NextResponse.json({ ok: true, removed: count });
  }

  // ── ATUALIZAR MEU E-MAIL ──
  if (action === 'update-email') {
    const { username, password, email } = body;
    if (!username || !password)
      return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
    const creds = await loadCreds();
    const key = normalizeKey(username);
    const user = creds[key];
    if (!user || !verifyPassword(password, user.password))
      return NextResponse.json({ error: 'Senha incorreta.' }, { status: 401 });
    creds[key] = { ...user, email: email || '' };
    await saveCreds(creds);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
