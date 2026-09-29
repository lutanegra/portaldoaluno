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

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

function roleOf(username: string, acc: PanelAccount): PanelRole {
  if (username === OWNER_KEY) return 'owner';
  return acc.nucleo === 'geral' ? 'admin_geral' : 'admin_nucleo';
}

/** Desafio de owner/admin geral para ações de gestão (senha na chamada, resolvida por login/CPF). */
async function requireGestor(creds: CredsMap, rawUsername?: string, password?: string): Promise<{ ok: boolean; key: string; owner: boolean }> {
  const key = resolveUsername(creds, rawUsername || '');
  const user = key ? creds[key] : undefined;
  if (!user || !password || !verifyPassword(password, user.password)) return { ok: false, key: '', owner: false };
  if (user.nucleo !== 'geral') return { ok: false, key: '', owner: false };
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

function setSessionCookie(res: NextResponse, username: string, nucleo: string, role: PanelRole) {
  const token = serializePanelSession(createPanelSession(username, nucleo, role));
  res.cookies.set(PANEL_COOKIE, token, panelCookieOptions());
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
    const role = roleOf(username, user);
    await appendAudit({
      actor: username,
      actor_type: 'admin',
      action: 'login_admin',
      details: { nucleo: user.nucleo, papel: role },
    });
    const res = NextResponse.json({
      ok: true,
      nucleo: user.nucleo,
      label: role === 'owner' ? 'Owner' : user.label,
      color: user.color,
      nome: user.nome || '',
      isGeral: user.nucleo === 'geral',
      isOwner: role === 'owner',
      role,
      first_login: user.first_login === true,
    });
    setSessionCookie(res, username, user.nucleo, role);
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
      role: roleOf(sess.u, acc),
      label: acc.label,
      nome: acc.nome || '',
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
    const list = await Promise.all(Object.entries(creds0).map(async ([u, c]) => {
      let nucleoNome: string | null = null;
      if (c.nucleo !== 'geral') {
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

    if (creds0[login]) return NextResponse.json({ error: `Login "${login}" já está em uso.` }, { status: 409 });
    if (cpf && Object.values(creds0).some(c => normalizeCpfDigits(c.cpf || '') === cpf)) {
      return NextResponse.json({ error: 'Este CPF já está vinculado a outra conta.' }, { status: 409 });
    }
    if (email && Object.values(creds0).some(c => normalizeEmail(c.email || '') === email)) {
      return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
    }

    creds0[login] = {
      nucleo: slug,
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
    return NextResponse.json({ ok: true, login, nucleo: slug, senha_definida: !!body.new_password, message: 'Conta criada e vinculada ao núcleo!' });
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

    const updated: PanelAccount = {
      ...acc,
      nome: body.nome !== undefined ? String(body.nome).trim() : acc.nome,
      email: email || undefined,
      cpf: cpf || undefined,
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
      details: { login_anterior: targetKey !== novoLogin ? targetKey : undefined, mudou_senha: !!novaSenhaHash, campos: ['nome', 'email', 'cpf'].filter(f => body[f] !== undefined) },
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
      const restantes = Object.keys(creds0).filter(k => creds0[k].nucleo === nucleoSlug);
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

  // ── ESQUECI MINHA SENHA (Supabase Auth envia o link) ──
  if (action === 'forgot-password') {
    const username = resolveUsername(creds0, String(body.username || ''));
    if (!username) {
      return NextResponse.json({ ok: true, sent: true, message: 'Se existir conta com este login e e-mail cadastrado, você receberá um link de redefinição.' });
    }
    const user = creds0[username];
    const email = normalizeEmail(user.email || '');
    if (!email) {
      return NextResponse.json({ ok: true, no_email: true, message: 'Sua conta não tem e-mail cadastrado. Fale com o Owner ou Admin Geral para redefinir sua senha.' });
    }
    await ensureSupabaseAuthUser(email, username, user.nome);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get('host')}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}/admin/redefinir-senha`,
    });
    if (error) {
      return NextResponse.json({
        ok: true,
        send_error: error.message,
        message: `Não foi possível enviar o e-mail agora (${error.message}). Tente novamente em alguns minutos ou fale com o Owner.`,
      });
    }
    await appendAudit({
      actor: username,
      actor_type: 'admin',
      action: 'senha_reset_solicitada',
      details: { email_mascarado: maskEmail(email), via: 'supabase_auth' },
    });
    return NextResponse.json({ ok: true, sent: true, email_mascarado: maskEmail(email), message: `Link de redefinição enviado para ${maskEmail(email)}. Verifique a caixa de entrada e o spam.` });
  }

  // ── REDEFINIR SENHA COM TOKEN DO SUPABASE AUTH ──
  if (action === 'reset-by-tokens') {
    const { access_token, new_password } = body as { access_token?: string; new_password?: string };
    if (!access_token || !new_password) return NextResponse.json({ error: 'Campos obrigatórios ausentes.' }, { status: 400 });
    if (String(new_password).length < 6) return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });

    const { data, error } = await supabase.auth.getUser(String(access_token));
    if (error || !data?.user) {
      return NextResponse.json({ error: 'Link inválido ou expirado. Solicite um novo em "Esqueci minha senha".' }, { status: 401 });
    }
    const { error: upErr } = await supabase.auth.admin.updateUserById(data.user.id, { password: String(new_password) });
    if (upErr) return NextResponse.json({ error: 'Erro ao atualizar a senha.' }, { status: 500 });

    const email = (data.user.email || '').toLowerCase();
    const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
    let credKey = normalizeLogin(String(meta.panel_login || ''));
    if (!credKey || !creds0[credKey] || normalizeEmail(creds0[credKey].email || '') !== email) {
      credKey = Object.keys(creds0).find(k => normalizeEmail(creds0[k].email || '') === email) || '';
    }
    if (credKey) {
      creds0[credKey] = { ...creds0[credKey], password: hashPassword(String(new_password)), first_login: false };
      await saveCreds(creds0);
    }
    await appendAudit({ actor: credKey || email, actor_type: 'admin', action: 'senha_redefinida_supabase', details: { via: 'link_email' } });
    return NextResponse.json({ ok: true, synced_panel: !!credKey });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
