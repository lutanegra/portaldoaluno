import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appendAudit } from '@/lib/audit';
import {
  hashPassword,
  verifyPassword,
  defaultPasswordForSlug,
  pickColorForSlug,
  loadCreds,
  saveCreds,
  resolveUsername,
  normalizeLogin,
  normalizeCpfDigits,
  normalizeEmail,
  ensureSupabaseAuthUser,
  publicAccount,
  sanitizeNucleoSlugs,
  accIsGeral,
  accNucleos,
  OWNER_KEY,
  type CredsMap,
  type PanelAccount,
} from '@/lib/panelCredentials';
import {
  PANEL_COOKIE,
  panelCookieOptions,
  createPanelSession,
  serializePanelSession,
  readPanelSession,
  type PanelRole,
} from '@/lib/panelSession';
import { sendEmail } from '@/lib/email';
import { runDueBackupIfNeeded } from '@/lib/backupSistema';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

function roleOf(username: string, acc: PanelAccount): PanelRole {
  if (username === OWNER_KEY) return 'owner';
  return accIsGeral(acc) ? 'admin_geral' : 'admin_nucleo';
}

/** includes() de slugs ignorando maiúsculas/espaços. */
function uaisIncludes(list: string[], slug: string): boolean {
  const alvo = (slug || '').trim().toLowerCase();
  return list.some(s => s.trim().toLowerCase() === alvo);
}

/** Desafio de owner/admin geral para ações de gestão (senha na chamada, resolvida por login/CPF). */
async function requireGestor(creds: CredsMap, rawUsername?: string, password?: string): Promise<{ ok: boolean; key: string; owner: boolean }> {
  const key = resolveUsername(creds, rawUsername || '');
  const user = key ? creds[key] : undefined;
  if (!user || !password || !verifyPassword(password, user.password)) return { ok: false, key: '', owner: false };
  if (!accIsGeral(user)) return { ok: false, key: '', owner: false };
  return { ok: true, key: key ?? '', owner: key === OWNER_KEY };
}

/** Sessão atual: cookie primeiro; fallback login+senha para compatibilidade. */
async function currentSession(creds: CredsMap, req: NextRequest, body: { username?: string; password?: string }): Promise<{ key: string; acc: PanelAccount; role: PanelRole } | null> {
  const sess = readPanelSession(req);
  if (sess && creds[sess.u]) {
    return { key: sess.u, acc: creds[sess.u], role: roleOf(sess.u, creds[sess.u]) };
  }
  if (body?.username && body?.password) {
    const resolved = resolveUsername(creds, body.username);
    if (!resolved) return null;
    const acc = creds[resolved];
    if (acc && verifyPassword(body.password, acc.password)) {
      return { key: resolved, acc, role: roleOf(resolved, acc) };
    }
  }
  return null;
}

async function findTenantBySlugOrNome(term: string): Promise<Record<string, unknown> | null> {
  if (!term) return null;
  const { data } = await supabase.from('tenants').select('*').eq('slug', term).maybeSingle();
  if (data) return data;
  const { data: byName } = await supabase.from('tenants').select('*').ilike('nome', term).maybeSingle();
  return byName || null;
}

function maskEmail(email: string): string {
  return email.replace(/(.{2}).+(@.+)/, '$1****$2');
}

function setSessionCookie(res: NextResponse, username: string, nucleo: string, role: PanelRole, nucleos?: string[]) {
  const token = serializePanelSession(createPanelSession(username, nucleo, role, nucleos));
  res.cookies.set(PANEL_COOKIE, token, panelCookieOptions());
}

/** Valida slugs extras e devolve { válidos, erro }. 'geral' e o principal são ignorados na limpeza. */
async function validateNucleoSlugs(slugs: string[]): Promise<{ ok: true; slugs: string[] } | { ok: false; error: string }> {
  for (const slug of slugs) {
    const { data } = await supabase.from('tenants').select('slug').eq('slug', slug).maybeSingle();
    if (!data) return { ok: false, error: `Núcleo "${slug}" não encontrado.` };
  }
  return { ok: true, slugs };
}

function maskCpf(cpf: string): string {
  if (cpf.length !== 11) return cpf ? '•••' : '';
  return `${cpf.slice(0, 3)}.•••.•••-${cpf.slice(9)}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action || '');
  const creds0 = await loadCreds();

  // ── LOGIN (username, CPF ou e-mail + senha) ──
  if (action === 'login') {
    const { password } = body;
    const username = resolveUsername(creds0, String(body.username || ''));
    if (!username || !password) {
      return NextResponse.json({ error: 'Informe login (ou CPF/e-mail) e senha.' }, { status: 400 });
    }
    const user = creds0[username];
    if (!user || !verifyPassword(String(password), user.password)) {
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }
    if (username.startsWith('__')) {
      // Entradas internas (ex.: código de recuperação pendente) não são contas.
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }
    const role = roleOf(username, user);
    await appendAudit({
      actor: username,
      actor_type: 'admin',
      action: 'login_admin',
      details: { nucleo: user.nucleo, nucleos: accNucleos(user), papel: role },
    });
    // Rede de segurança do backup automático: cada login no painel verifica no
    // servidor se a cópia agendada venceu (disparo assíncrono, resposta imediata).
    runDueBackupIfNeeded(false).catch(() => {});
    const res = NextResponse.json({
      ok: true,
      nucleo: user.nucleo,
      nucleos: accNucleos(user),
      label: role === 'owner' ? 'Owner' : user.label,
      color: user.color,
      nome: user.nome || '',
      isGeral: accIsGeral(user),
      isOwner: role === 'owner',
      role,
      first_login: user.first_login === true,
    });
    setSessionCookie(res, username, user.nucleo, role, accNucleos(user));
    return res;
  }

  // ── LOGOUT ──
  if (action === 'logout') {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(PANEL_COOKIE, '', { ...panelCookieOptions(), maxAge: 0 });
    return res;
  }

  // ── QUEM SOU (sessão cookie) ──
  if (action === 'me') {
    const sess = readPanelSession(req);
    if (!sess || !creds0[sess.u]) return NextResponse.json({ authenticated: false });
    const acc = creds0[sess.u];
    return NextResponse.json({
      authenticated: true,
      username: sess.u,
      nucleo: acc.nucleo,
      nucleos: accNucleos(acc),
      role: roleOf(sess.u, acc),
      label: acc.label,
      nome: acc.nome || '',
      display_name: acc.nome || sess.u,
      email: acc.email || '',
      cpf: maskCpf(normalizeCpfDigits(acc.cpf || '')),
      is_owner: sess.u === OWNER_KEY,
    });
  }

  // ── VERIFICAR SENHA (gate de gestão) ──
  if (action === 'verify-login') {
    const g = await requireGestor(creds0, String(body.username || ''), String(body.password || ''));
    if (!g.ok) return NextResponse.json({ error: 'Senha incorreta ou conta sem permissão de gestão.' }, { status: 401 });
    return NextResponse.json({ ok: true, username: g.key });
  }

  // ── LISTAR CONTAS DO PAINEL ──
  if (action === 'list-users') {
    const g = await requireGestor(creds0, String(body.admin_username || body.username || ''), String(body.admin_password || body.password || ''));
    if (!g.ok) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    const list = await Promise.all(Object.entries(creds0)
      .filter(([u]) => u !== '__admin_otp')
      .map(async ([u, c]) => {
      const nucleosDaConta = accNucleos(c);
      let nucleoNome: string | null = null;
      if (nucleosDaConta.length > 0) {
        const { data } = await supabase.from('tenants').select('nome').eq('slug', c.nucleo).maybeSingle();
        nucleoNome = data?.nome || c.nucleo;
      }
      return { ...publicAccount(u, c, nucleoNome), created_by: c.createdBy || '' };
    }));
    return NextResponse.json(list);
  }

  // ── CRIAR ADMIN DE NÚCLEO ──
  if (action === 'create-user') {
    const g = await requireGestor(creds0, String(body.admin_username || body.username || ''), String(body.admin_password || body.password || ''));
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem criar contas.' }, { status: 403 });

    const login = normalizeLogin(String(body.login || ''));
    if (login.length < 3 || /\s/.test(login)) {
      return NextResponse.json({ error: 'Login deve ter pelo menos 3 caracteres e sem espaços.' }, { status: 400 });
    }
    if (login === OWNER_KEY || login === 'admin') {
      return NextResponse.json({ error: 'Este login é reservado.' }, { status: 409 });
    }
    const tenant = await findTenantBySlugOrNome(String(body.nucleo_key || body.nucleo_slug || ''));
    if (!tenant) return NextResponse.json({ error: 'Núcleo inválido.' }, { status: 400 });
    const slug = String(tenant.slug);

    const novaSenha = body.new_password ? String(body.new_password) : defaultPasswordForSlug(slug);
    if (novaSenha.length < 6) {
      return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres (ou deixe vazia para o padrão).' }, { status: 400 });
    }

    const email = normalizeEmail(String(body.email || ''));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }
    const cpf = normalizeCpfDigits(String(body.cpf || ''));
    if (cpf && cpf.length !== 11) {
      return NextResponse.json({ error: 'CPF deve ter 11 dígitos.' }, { status: 400 });
    }

    // Núcleos adicionais gerenciados pela mesma conta (opcional)
    const extrasBrutos = sanitizeNucleoSlugs(body.nucleos);
    const extras = extrasBrutos.filter(s => s !== slug);
    const extrasCheck = await validateNucleoSlugs(extras);
    if (!extrasCheck.ok) return NextResponse.json({ error: extrasCheck.error }, { status: 400 });

    if (creds0[login]) return NextResponse.json({ error: `Login "${login}" já está em uso.` }, { status: 409 });
    if (cpf && Object.values(creds0).some(c => normalizeCpfDigits(c.cpf || '') === cpf)) {
      return NextResponse.json({ error: 'Este CPF já está vinculado a outra conta.' }, { status: 409 });
    }
    if (email && Object.values(creds0).some(c => normalizeEmail(c.email || '') === email)) {
      return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
    }

    creds0[login] = {
      nucleo: slug,
      nucleos: extras.length > 0 ? extras : undefined,
      label: String(tenant.nome),
      color: pickColorForSlug(slug),
      password: hashPassword(novaSenha),
      nome: String(body.nome || '').trim(),
      email: email || undefined,
      cpf: cpf || undefined,
      createdBy: g.key,
      first_login: false,
    };
    const { data: tenantRow } = await supabase.from('tenants').select('admin_login').eq('id', (tenant as { id: string }).id).maybeSingle();
    if (!tenantRow?.admin_login) {
      await supabase.from('tenants').update({ admin_login: login }).eq('id', (tenant as { id: string }).id);
    }
    await saveCreds(creds0);
    if (email) await ensureSupabaseAuthUser(email, login, String(body.nome || ''));

    await appendAudit({
      actor: g.key,
      actor_type: 'admin',
      action: 'conta_admin_criada',
      target_id: login,
      target_name: String(body.nome || '') || undefined,
      details: { nucleo: slug, senha_padrao: !body.new_password, com_email: !!email, com_cpf: !!cpf },
    });
    return NextResponse.json({ ok: true, login, nucleo: slug, nucleos: extras, senha_definida: !!body.new_password, message: 'Conta criada e vinculada ao núcleo!' });
  }

  // ── CRIAR ADMIN GERAL ADICIONAL ──
  if (action === 'create-geral') {
    const g = await requireGestor(creds0, String(body.admin_username || body.username || ''), String(body.admin_password || body.password || ''));
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem criar contas.' }, { status: 403 });

    const newKey = normalizeLogin(String(body.new_username || ''));
    if (newKey.length < 3) return NextResponse.json({ error: 'Login deve ter pelo menos 3 caracteres.' }, { status: 400 });
    if (newKey === OWNER_KEY) return NextResponse.json({ error: 'Não é possível criar outro owner.' }, { status: 400 });
    if (String(body.new_password || '').length < 6) {
      return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }
    const email = normalizeEmail(String(body.email || ''));
    const cpf = normalizeCpfDigits(String(body.cpf || ''));
    if (cpf && cpf.length !== 11) return NextResponse.json({ error: 'CPF deve ter 11 dígitos.' }, { status: 400 });

    const creds = creds0;
    const totalGeral = Object.values(creds).filter(c => c.nucleo === 'geral').length;
    if (totalGeral >= 4) return NextResponse.json({ error: 'Limite de administradores gerais atingido (Owner + 3).' }, { status: 400 });
    if (creds[newKey]) return NextResponse.json({ error: `Login "${newKey}" já existe.` }, { status: 409 });
    if (cpf && Object.values(creds).some(c => normalizeCpfDigits(c.cpf || '') === cpf)) {
      return NextResponse.json({ error: 'Este CPF já está vinculado a outra conta.' }, { status: 409 });
    }
    if (email && Object.values(creds).some(c => normalizeEmail(c.email || '') === email)) {
      return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
    }

    creds[newKey] = {
      nucleo: 'geral',
      label: 'Admin Geral',
      color: '#1d4ed8',
      password: hashPassword(String(body.new_password)),
      nome: String(body.nome || '').trim(),
      email: email || undefined,
      cpf: cpf || undefined,
      createdBy: g.key,
      first_login: false,
    };
    await saveCreds(creds);
    if (email) await ensureSupabaseAuthUser(email, newKey, String(body.nome || ''));
    await appendAudit({ actor: g.key, actor_type: 'admin', action: 'conta_admin_criada', target_id: newKey, details: { nucleo: 'geral' } });
    return NextResponse.json({ ok: true, username: newKey });
  }

  // ── EDITAR CONTA (login, nome, e-mail, CPF, senha) ──
  if (action === 'update-user') {
    const g = await requireGestor(creds0, String(body.admin_username || body.username || ''), String(body.admin_password || body.password || ''));
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem editar contas.' }, { status: 403 });
    const targetKey = normalizeLogin(String(body.target_username || ''));
    const acc = creds0[targetKey];
    if (!acc) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });

    const novoLogin = body.login !== undefined ? normalizeLogin(String(body.login)) : targetKey;
    if (novoLogin.length < 3 || /\s/.test(novoLogin)) {
      return NextResponse.json({ error: 'Login deve ter pelo menos 3 caracteres.' }, { status: 400 });
    }
    if ((novoLogin === OWNER_KEY || novoLogin === 'admin') && novoLogin !== targetKey) {
      return NextResponse.json({ error: 'Este login é reservado.' }, { status: 409 });
    }
    if (creds0[novoLogin] && novoLogin !== targetKey) {
      return NextResponse.json({ error: `Login "${novoLogin}" já está em uso.` }, { status: 409 });
    }
    const email = body.email !== undefined ? normalizeEmail(String(body.email)) : (acc.email || '');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }
    if (email && Object.entries(creds0).some(([k, c]) => k !== targetKey && normalizeEmail(c.email || '') === email)) {
      return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
    }
    const cpf = body.cpf !== undefined ? normalizeCpfDigits(String(body.cpf)) : (acc.cpf || '');
    if (cpf && cpf.length !== 11) return NextResponse.json({ error: 'CPF deve ter 11 dígitos.' }, { status: 400 });
    if (cpf && Object.entries(creds0).some(([k, c]) => k !== targetKey && normalizeCpfDigits(c.cpf || '') === cpf)) {
      return NextResponse.json({ error: 'Este CPF já está vinculado a outra conta.' }, { status: 409 });
    }
    let novaSenhaHash: string | undefined;
    if (body.new_password) {
      const np = String(body.new_password);
      if (np.length < 6) return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      novaSenhaHash = hashPassword(np);
    }

    // Núcleos adicionais gerenciados pela conta (edição)
    let extrasAtualizados: string[] | undefined;
    if (body.nucleos !== undefined && accIsGeral(acc) === false) {
      const principais = accNucleos(acc);
      const principal = principais[0] || acc.nucleo;
      const brutos = sanitizeNucleoSlugs(body.nucleos);
      const extras = brutos.filter(s => s !== principal);
      const extrasCheck = await validateNucleoSlugs(extras);
      if (!extrasCheck.ok) return NextResponse.json({ error: extrasCheck.error }, { status: 400 });
      extrasAtualizados = extras.length > 0 ? extras : undefined;
    }

    const updated: PanelAccount = {
      ...acc,
      nome: body.nome !== undefined ? String(body.nome).trim() : acc.nome,
      email: email || undefined,
      cpf: cpf || undefined,
      nucleos: extrasAtualizados !== undefined ? extrasAtualizados : acc.nucleos,
    };
    if (novaSenhaHash) { updated.password = novaSenhaHash; updated.first_login = false; }
    delete creds0[targetKey];
    creds0[novoLogin] = updated;
    await saveCreds(creds0);

    // Sincroniza vínculo do núcleo quando o login primário é renomeado
    if (novoLogin !== targetKey && acc.nucleo !== 'geral') {
      await supabase.from('tenants').update({ admin_login: novoLogin }).eq('slug', acc.nucleo).eq('admin_login', targetKey);
    }
    if (email) await ensureSupabaseAuthUser(email, novoLogin, updated.nome);

    await appendAudit({
      actor: g.key,
      actor_type: 'admin',
      action: 'conta_admin_editada',
      target_id: novoLogin,
      details: {
        login_anterior: targetKey !== novoLogin ? targetKey : undefined,
        mudou_senha: !!novaSenhaHash,
        nucleos: accNucleos(updated),
        campos: ['nome', 'email', 'cpf', 'nucleos'].filter(f => body[f] !== undefined),
      },
    });
    return NextResponse.json({ ok: true, username: novoLogin });
  }

  // ── REDEFINIR SENHA DE UM USUÁRIO ──
  if (action === 'reset-password') {
    const g = await requireGestor(creds0, String(body.admin_username || body.username || ''), String(body.admin_password || body.password || ''));
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem redefinir senhas.' }, { status: 403 });
    const targetKey = normalizeLogin(String(body.target_username || ''));
    if (!creds0[targetKey]) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    if (String(body.new_password || '').length < 6) {
      return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    }
    creds0[targetKey] = { ...creds0[targetKey], password: hashPassword(String(body.new_password)), first_login: false };
    await saveCreds(creds0);
    await appendAudit({ actor: g.key, actor_type: 'admin', action: 'senha_admin_alterada', target_id: targetKey });
    return NextResponse.json({ ok: true });
  }

  // ── REMOVER CONTA DO PAINEL ──
  if (action === 'delete-user') {
    const g = await requireGestor(creds0, String(body.admin_username || body.username || ''), String(body.admin_password || body.password || ''));
    if (!g.ok) return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem remover contas.' }, { status: 403 });
    const targetKey = normalizeLogin(String(body.target_username || ''));
    if (targetKey === OWNER_KEY || targetKey === 'admin') {
      return NextResponse.json({ error: 'As contas Owner e Admin Geral principal não podem ser removidas.' }, { status: 400 });
    }
    if (targetKey === g.key) return NextResponse.json({ error: 'Você não pode remover sua própria conta.' }, { status: 400 });
    if (!creds0[targetKey]) return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 404 });
    const nucleoSlug = creds0[targetKey].nucleo;
    delete creds0[targetKey];
    await saveCreds(creds0);
    if (nucleoSlug && nucleoSlug !== 'geral') {
      const restantes = Object.keys(creds0).filter(k => accNucleos(creds0[k]).includes(nucleoSlug));
      if (restantes.length === 0) {
        await supabase.from('tenants').update({ admin_login: null }).eq('slug', nucleoSlug).eq('admin_login', targetKey);
      } else if (restantes.length === 1) {
        await supabase.from('tenants').update({ admin_login: restantes[0] }).eq('slug', nucleoSlug).eq('admin_login', targetKey);
      }
    }
    await appendAudit({ actor: g.key, actor_type: 'admin', action: 'conta_admin_removida', target_id: targetKey, details: { nucleo: nucleoSlug || null } });
    return NextResponse.json({ ok: true });
  }

  // ── MINHA CONTA (qualquer admin logado, via cookie) ──
  if (action === 'my-account') {
    const sess = await currentSession(creds0, req, body as { username?: string; password?: string });
    if (!sess) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    return NextResponse.json({
      ok: true,
      username: sess.key,
      nucleo: sess.acc.nucleo,
      nucleos: accNucleos(sess.acc),
      role: sess.role,
      nome: sess.acc.nome || '',
      email: sess.acc.email || '',
      cpf: maskCpf(normalizeCpfDigits(sess.acc.cpf || '')),
    });
  }

  if (action === 'change-my-password') {
    const sess = await currentSession(creds0, req, body as { username?: string; password?: string });
    if (!sess) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    const { current_password, new_password } = body as { current_password?: string; new_password?: string };
    if (!current_password || !new_password) return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
    if (String(new_password).length < 6) return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    if (!verifyPassword(String(current_password), sess.acc.password)) {
      return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 401 });
    }
    creds0[sess.key] = { ...sess.acc, password: hashPassword(String(new_password)), first_login: false };
    await saveCreds(creds0);
    await appendAudit({ actor: sess.key, actor_type: 'admin', action: 'senha_proprio_alterada', details: { nucleo: sess.acc.nucleo } });
    return NextResponse.json({ ok: true });
  }

  if (action === 'update-my-contact') {
    const sess = await currentSession(creds0, req, body as { username?: string; password?: string });
    if (!sess) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    const email = body.email !== undefined ? normalizeEmail(String(body.email)) : (sess.acc.email || '');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    if (email && Object.entries(creds0).some(([k, c]) => k !== sess.key && normalizeEmail(c.email || '') === email)) {
      return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
    }
    const cpf = body.cpf !== undefined ? normalizeCpfDigits(String(body.cpf)) : (sess.acc.cpf || '');
    if (cpf && cpf.length !== 11) return NextResponse.json({ error: 'CPF deve ter 11 dígitos.' }, { status: 400 });
    if (cpf && Object.entries(creds0).some(([k, c]) => k !== sess.key && normalizeCpfDigits(c.cpf || '') === cpf)) {
      return NextResponse.json({ error: 'Este CPF já está vinculado a outra conta.' }, { status: 409 });
    }
    creds0[sess.key] = { ...sess.acc, email: email || undefined, cpf: cpf || undefined, nome: body.nome !== undefined ? String(body.nome).trim() : sess.acc.nome };
    await saveCreds(creds0);
    if (email) await ensureSupabaseAuthUser(email, sess.key, sess.acc.nome);
    await appendAudit({ actor: sess.key, actor_type: 'admin', action: 'conta_proprio_atualizada', details: { com_email: !!email, com_cpf: !!cpf } });
    return NextResponse.json({ ok: true, email: email || '', cpf: maskCpf(cpf) });
  }

  // ── VINCULAR NOVO NÚCLEO à própria conta de admin de núcleo (senha da conta exigida) ──
  if (action === 'link-nucleo') {
    const sess = await currentSession(creds0, req, body as { username?: string; password?: string });
    if (!sess) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    // Regra: só Owner/Admin Geral alteram os núcleos que uma conta gerencia
    if (!accIsGeral(sess.acc)) {
      return NextResponse.json({ error: 'Somente o Owner ou o Admin Geral podem vincular núcleos a uma conta.' }, { status: 403 });
    }
    const alvoKey = resolveUsername(creds0, String(body.username || ''));
    if (!alvoKey) return NextResponse.json({ error: 'Conta alvo não encontrada.' }, { status: 404 });
    const alvo = creds0[alvoKey];
    if (accIsGeral(alvo)) return NextResponse.json({ error: 'Gestores já enxergam todos os núcleos.' }, { status: 400 });
    const slug = normalizeLogin(String(body.nucleo_slug || ''));
    if (!slug) return NextResponse.json({ error: 'Informe o núcleo a vincular.' }, { status: 400 });
    const check = await validateNucleoSlugs([slug]);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    const atuais = accNucleos(alvo);
    if (uaisIncludes(atuais, slug)) return NextResponse.json({ error: 'Este núcleo já está vinculado a essa conta.' }, { status: 409 });
    const principal = atuais[0] || alvo.nucleo;
    const extras = sanitizeNucleoSlugs([...atuais, slug]).filter(s => s !== principal);
    creds0[alvoKey] = { ...alvo, nucleo: principal, nucleos: extras.length > 0 ? extras : undefined };
    await saveCreds(creds0);
    await appendAudit({ actor: sess.key, actor_type: 'admin', action: 'nucleo_vinculado', target_id: slug, details: { conta: alvoKey, nucleos: accNucleos(creds0[alvoKey]) } });
    return NextResponse.json({ ok: true, nucleo: principal, nucleos: accNucleos(creds0[alvoKey]) });
  }

  // ── DESVINCULAR um núcleo de uma conta (somente Owner/Admin Geral; principal intocável) ──
  if (action === 'unlink-nucleo') {
    const sess = await currentSession(creds0, req, body as { username?: string; password?: string });
    if (!sess) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    if (!accIsGeral(sess.acc)) {
      return NextResponse.json({ error: 'Somente o Owner ou o Admin Geral podem desvincular núcleos de uma conta.' }, { status: 403 });
    }
    const alvoKey = resolveUsername(creds0, String(body.username || ''));
    if (!alvoKey) return NextResponse.json({ error: 'Conta alvo não encontrada.' }, { status: 404 });
    const alvo = creds0[alvoKey];
    if (accIsGeral(alvo)) return NextResponse.json({ error: 'Gestores já enxergam todos os núcleos.' }, { status: 400 });
    const slug = normalizeLogin(String(body.nucleo_slug || ''));
    const atuais = accNucleos(alvo);
    const principal = atuais[0] || alvo.nucleo;
    if (!uaisIncludes(atuais, slug)) return NextResponse.json({ error: 'Este núcleo não está vinculado a essa conta.' }, { status: 404 });
    if (slug === principal) return NextResponse.json({ error: 'O núcleo principal não pode ser desvinculado.' }, { status: 400 });
    const extras = sanitizeNucleoSlugs(atuais.filter(s => s !== slug)).filter(s => s !== principal);
    creds0[alvoKey] = { ...alvo, nucleo: principal, nucleos: extras.length > 0 ? extras : undefined };
    await saveCreds(creds0);
    await appendAudit({ actor: sess.key, actor_type: 'admin', action: 'nucleo_desvinculado', target_id: slug, details: { conta: alvoKey, nucleos: accNucleos(creds0[alvoKey]) } });
    return NextResponse.json({ ok: true, nucleo: principal, nucleos: accNucleos(creds0[alvoKey]) });
  }

  // ── ESQUECI MINHA SENHA (código por e-mail via Resend/SMTP) ──
  if (action === 'forgot-password') {
    const username = resolveUsername(creds0, String(body.username || ''));
    if (!username) {
      // Resposta neutra: não revelar quais logins existem
      return NextResponse.json({ ok: true, sent: true, message: 'Se existir conta com este login e e-mail cadastrado, você receberá um código de recuperação.' });
    }
    const user = creds0[username];
    const email = normalizeEmail(user.email || '');
    if (!email) {
      return NextResponse.json({ ok: true, no_email: true, message: 'Sua conta não tem e-mail cadastrado. Fale com o Owner ou Admin Geral para redefinir sua senha.' });
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const otpAcc: PanelAccount = {
      nucleo: '__otp__',
      label: 'Código de recuperação pendente',
      color: '#FF9200',
      password: hashPassword(otp),
      email,
      nome: user.nome || '',
      first_login: false,
    };
    creds0.__admin_otp = Object.assign(otpAcc, { otp_expires: expires });
    await saveCreds(creds0);
    const { buildAdminOtpHtml } = await import('@/lib/email');
    const tmpl = buildAdminOtpHtml(user.nome || '', otp);
    const result = await sendEmail(email, tmpl.subject, tmpl.html);
    if (!result.sent) {
      delete creds0.__admin_otp;
      await saveCreds(creds0);
      return NextResponse.json({
        ok: true,
        send_error: result.error || 'envio_nao_configurado',
        message: 'Não foi possível enviar o e-mail agora. Peça ao Owner para configurar o envio (aba Config. E-mail) ou redefinir sua senha em Contas de Acesso.',
      });
    }
    await appendAudit({
      actor: username,
      actor_type: 'admin',
      action: 'senha_reset_solicitada',
      details: { email_mascarado: maskEmail(email), via: 'codigo_email' },
    });
    return NextResponse.json({ ok: true, sent: true, email_mascarado: maskEmail(email), message: `Código enviado para ${maskEmail(email)}. Verifique a caixa de entrada e o spam.` });
  }

  // ── VALIDAR CÓDIGO DE RECUPERAÇÃO ──
  if (action === 'verify-reset-code') {
    const otp = String(body.code || '').replace(/\D/g, '');
    const pend = creds0.__admin_otp as (PanelAccount & { otp_expires?: string }) | undefined;
    if (!pend || !otp) return NextResponse.json({ error: 'Nenhum código pendente. Solicite um novo.' }, { status: 400 });
    if (!pend.otp_expires || new Date(pend.otp_expires) < new Date()) {
      delete creds0.__admin_otp;
      await saveCreds(creds0);
      return NextResponse.json({ error: 'Código expirado. Solicite um novo.' }, { status: 400 });
    }
    if (!verifyPassword(otp, pend.password)) {
      return NextResponse.json({ error: 'Código incorreto.' }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  }

  // ── REDEFINIR SENHA COM O CÓDIGO VALIDADO ──
  if (action === 'reset-with-code') {
    const otp = String(body.code || '').replace(/\D/g, '');
    const newPassword = String(body.new_password || '');
    if (newPassword.length < 6) return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
    const pend = creds0.__admin_otp as (PanelAccount & { otp_expires?: string }) | undefined;
    if (!pend || !otp) return NextResponse.json({ error: 'Nenhum código pendente. Solicite um novo.' }, { status: 400 });
    if (!pend.otp_expires || new Date(pend.otp_expires) < new Date()) {
      delete creds0.__admin_otp;
      await saveCreds(creds0);
      return NextResponse.json({ error: 'Código expirado. Solicite um novo.' }, { status: 400 });
    }
    if (!verifyPassword(otp, pend.password)) {
      return NextResponse.json({ error: 'Código incorreto.' }, { status: 401 });
    }
    const email = normalizeEmail(pend.email || '');
    const targetKey = Object.keys(creds0).find(k => k !== '__admin_otp' && normalizeEmail(creds0[k].email || '') === email);
    if (!targetKey) return NextResponse.json({ error: 'Conta não encontrada para este e-mail.' }, { status: 404 });
    creds0[targetKey] = { ...creds0[targetKey], password: hashPassword(newPassword), first_login: false };
    delete creds0.__admin_otp;
    await saveCreds(creds0);
    await appendAudit({ actor: targetKey, actor_type: 'admin', action: 'senha_redefinida_codigo_email', details: { via: 'codigo_email' } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
