import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import {
  SESSION_COOKIE,
  createAlunoSession,
  serializeAlunoSession,
  sessionCookieOptions,
  readAlunoSessionFromReq,
} from '@/lib/alunoSession';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { appendAudit } from '@/lib/audit';
import { idadeEm } from '@/lib/idade';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const AUTH_KEY = 'config/aluno-auth.json';

type AlunoAccount = {
  student_id: string;
  username: string;
  email?: string;
  password_hash: string;
  salt: string;
  active: boolean;
  phone?: string;
  created_at: string;
  last_login?: string;
};

async function loadFromStorage(key: string): Promise<Record<string, unknown>> {
  try {
    const { data: urlData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, 30);
    if (!urlData?.signedUrl) return {};
    const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveAuthMap(map: Record<string, unknown>): Promise<void> {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(AUTH_KEY, blob, { upsert: true });
}

async function loadAuthMap(): Promise<Record<string, AlunoAccount>> {
  return (await loadFromStorage(AUTH_KEY)) as Record<string, AlunoAccount>;
}

function hashPassword(password: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

/* ── E-mail OTP de 6 dígitos (recuperação de senha) ───────────────────────── */

function gerarOtp(): string { return String(Math.floor(100000 + Math.random() * 900000)); }

function hashOtp(otp: string): string {
  const segredo = process.env.PA_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'portal-aluno-dev-secret';
  return crypto.createHmac('sha256', segredo).update(`aluno-otp:${otp}`).digest('hex');
}

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_TENTATIVAS = 5;

async function enviarOtpEmail(destino: string, nome: string, codigo: string): Promise<boolean> {
  try {
    const { buildOtpHtml, sendEmail } = await import('@/lib/email');
    const { subject, html } = buildOtpHtml(nome, codigo);
    const r = await sendEmail(destino, subject, html);
    return !!r?.sent;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  try {
    const sess = readAlunoSessionFromReq(req);
    if (!sess) return NextResponse.json({ authenticated: false });
    const store = await cookies();

    if (req.nextUrl.searchParams.get('action') === 'logout') {
      store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
      return NextResponse.json({ success: true });
    }

    // ── Sessão válida: renovar a validade a cada visita (permanece logado) ──
    const renovada = createAlunoSession(sess.sid, sess.un);
    store.set(SESSION_COOKIE, serializeAlunoSession(renovada), sessionCookieOptions());

    // ── Retomar o último perfil usado neste dispositivo ────────────────────
    let profile: string | undefined;
    try {
      profile = req.headers.get('cookie')?.match(new RegExp('pa_profile=([^;]+)'))?.[1];
      if (profile) profile = decodeURIComponent(profile);
    } catch { profile = undefined; }
    const perfilCookie = profile ? await import('@/lib/ator').then(m => m.readProfileFromCookieValue(profile)) : null;
    const perfilAtivo = perfilCookie ? perfilCookie.sid : sess.sid;

    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, nucleo, graduacao, tipo_graduacao, foto_url, apelido, nome_social')
      .eq('id', perfilAtivo)
      .maybeSingle();
    if (!student) {
      // Perfil do cookie sumiu — cai para a própria conta e invalida o cookie de perfil
      store.set('pa_profile', '', { ...sessionCookieOptions(), maxAge: 0 });
      const { data: proprio } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, nucleo, graduacao, tipo_graduacao, foto_url, apelido, nome_social')
        .eq('id', sess.sid)
        .maybeSingle();
      if (!proprio) {
        // Aluno deletado — invalida o cookie
        store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
        return NextResponse.json({ authenticated: false });
      }
      return NextResponse.json({ authenticated: true, session: { student_id: sess.sid, username: sess.un }, student: proprio });
    }
    return NextResponse.json({ authenticated: true, session: { student_id: sess.sid, username: sess.un }, student, perfil_ativo: perfilAtivo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/aluno/auth
// Actions: login, register, register-responsavel, verify-otp, forgot-password, reset-password, change-password
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || '');

    /* ── Recuperação de senha por e-mail (sem sessão) ─────────────────────── */

    if (action === 'forgot-password') {
      const ident = String(body.username || body.email || '').trim().toLowerCase();
      if (!ident) return NextResponse.json({ error: 'Informe seu usuário ou e-mail.' }, { status: 400 });
      const authMap = await loadAuthMap();
      const acc = Object.values(authMap).find(
        a => a.username?.toLowerCase() === ident || (a.email || '').toLowerCase() === ident
      );
      if (!acc?.email) {
        // Resposta neutra: não revela se a conta existe
        return NextResponse.json({ success: true, message: 'Se existir uma conta com esse e-mail, o código foi enviado.' });
      }
      const otp = gerarOtp();
      const otpData = {
        hash: hashOtp(otp),
        expira_em: Date.now() + OTP_TTL_MS,
        tentativas: 0,
        target: acc.student_id,
      };
      const otpKey = 'config/aluno-otp.json';
      let prev: Record<string, typeof otpData> = {};
      try { prev = (await loadFromStorage(otpKey)) as Record<string, typeof otpData>; } catch {}
      prev[acc.student_id] = otpData;
      const blob = new Blob([JSON.stringify(prev, null, 2)], { type: 'application/json' });
      await supabaseAdmin.storage.from(BUCKET).upload(otpKey, blob, { upsert: true });
      const ok = await enviarOtpEmail(acc.email, acc.username || '', otp);
      if (!ok) return NextResponse.json({ error: 'Não foi possível enviar o e-mail agora. Tente novamente em instantes.' }, { status: 502 });
      await appendAudit({ actor: acc.username || acc.student_id, actor_type: 'student', action: 'aluno_senha_reset_solicitado', target_id: acc.student_id });
      return NextResponse.json({ success: true, message: 'Se existir uma conta com esse e-mail, o código foi enviado.' });
    }

    if (action === 'verify-reset-code') {
      const code = String(body.code || '').replace(/\D/g, '');
      const ident = String(body.username || body.email || '').trim().toLowerCase();
      const otpKey = 'config/aluno-otp.json';
      const stored = (await loadFromStorage(otpKey)) as Record<string, { hash: string; expira_em: number; tentativas: number; target: string }>;
      const accEntry = Object.entries(await loadAuthMap()).find(
        ([, a]) => a.username?.toLowerCase() === ident || (a.email || '').toLowerCase() === ident
      );
      const entry = accEntry ? stored[accEntry[1].student_id] : undefined;
      if (!entry || entry.expira_em < Date.now()) {
        return NextResponse.json({ error: 'Código expirado. Solicite um novo.' }, { status: 400 });
      }
      if (entry.tentativas >= OTP_MAX_TENTATIVAS) {
        return NextResponse.json({ error: 'Muitas tentativas. Solicite um novo código.' }, { status: 429 });
      }
      if (hashOtp(code) !== entry.hash) {
        stored[accEntry![1].student_id].tentativas += 1;
        const blob = new Blob([JSON.stringify(stored, null, 2)], { type: 'application/json' });
        await supabaseAdmin.storage.from(BUCKET).upload(otpKey, blob, { upsert: true });
        return NextResponse.json({ error: 'Código incorreto.' }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'reset-password') {
      const code = String(body.code || '').replace(/\D/g, '');
      const nova = String(body.password || '');
      const ident = String(body.username || body.email || '').trim().toLowerCase();
      if (nova.length < 6) return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      const otpKey = 'config/aluno-otp.json';
      const stored = (await loadFromStorage(otpKey)) as Record<string, { hash: string; expira_em: number; tentativas: number; target: string }>;
      const accEntry = Object.entries(await loadAuthMap()).find(
        ([, a]) => a.username?.toLowerCase() === ident || (a.email || '').toLowerCase() === ident
      );
      const entry = accEntry ? stored[accEntry[1].student_id] : undefined;
      if (!entry || entry.expira_em < Date.now()) {
        return NextResponse.json({ error: 'Código expirado. Solicite um novo.' }, { status: 400 });
      }
      if (hashOtp(code) !== entry.hash) {
        return NextResponse.json({ error: 'Código incorreto.' }, { status: 400 });
      }
      const authMap = await loadAuthMap();
      const acc = accEntry?.[1];
      if (!acc) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
      const salt = crypto.randomBytes(16).toString('hex');
      authMap[acc.student_id] = {
        ...acc,
        password_hash: hashPassword(nova, salt),
        salt,
      };
      await saveAuthMap(authMap);
      delete stored[acc.student_id];
      const blob = new Blob([JSON.stringify(stored, null, 2)], { type: 'application/json' });
      await supabaseAdmin.storage.from(BUCKET).upload(otpKey, blob, { upsert: true });
      await appendAudit({ actor: acc.username || acc.student_id, actor_type: 'student', action: 'aluno_senha_redefinida', target_id: acc.student_id });
      try {
        const { notificarSeguranca } = await import('@/lib/push/integracoes');
        await notificarSeguranca(acc.student_id, 'Sua senha foi alterada', 'Se não foi você, redefina a senha agora e procure seu núcleo.', 'senha_alterada');
      } catch {}
      return NextResponse.json({ success: true });
    }

    if (action === 'change-password') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const { senha_atual, nova_senha } = body;
      const authMap = await loadAuthMap();
      const acc = authMap[sess.sid];
      if (!acc) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
      if (hashPassword(String(senha_atual || ''), acc.salt) !== acc.password_hash) {
        return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 400 });
      }
      if (String(nova_senha || '').length < 6) {
        return NextResponse.json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      authMap[sess.sid] = { ...acc, password_hash: hashPassword(String(nova_senha), salt), salt };
      await saveAuthMap(authMap);
      await appendAudit({ actor: sess.un || sess.sid, actor_type: 'student', action: 'aluno_senha_alterada', target_id: sess.sid });
      try {
        const { notificarSeguranca } = await import('@/lib/push/integracoes');
        await notificarSeguranca(sess.sid, 'Sua senha foi alterada', 'Se não foi você, troque a senha agora.', 'senha_alterada');
      } catch {}
      return NextResponse.json({ success: true });
    }

    /* ── Login / cadastro ─────────────────────────────────────────────────── */

    const { username, password } = body;
    if (!username || !password) return NextResponse.json({ error: 'Informe usuário e senha.' }, { status: 400 });

    const authMap = await loadAuthMap();
    const ident = String(username).trim().toLowerCase();
    const acc = Object.values(authMap).find(
      a => a.username?.toLowerCase() === ident || (a.email || '').toLowerCase() === ident
    );
    if (!acc) return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    if (acc.active === false) return NextResponse.json({ error: 'Conta desativada. Fale com seu núcleo.' }, { status: 403 });

    const hash = hashPassword(String(password), acc.salt);
    if (hash !== acc.password_hash) {
      return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
    }

    const sess = createAlunoSession(acc.student_id, acc.username);
    const token = serializeAlunoSession(sess);
    const store = await cookies();
    store.set(SESSION_COOKIE, token, sessionCookieOptions());

    // Auditoria + notificação de segurança (novo login)
    try {
      await appendAudit({ actor: acc.username, actor_type: 'student', action: 'aluno_login', target_id: acc.student_id });
    } catch {}
    try {
      const { notificarSeguranca } = await import('@/lib/push/integracoes');
      await notificarSeguranca(acc.student_id, 'Novo acesso à sua conta', 'Entrada reconhecida no Portal Aluno.', 'novo_login');
    } catch {}

    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, nucleo, graduacao, tipo_graduacao, foto_url, apelido, nome_social')
      .eq('id', acc.student_id)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      student_id: acc.student_id,
      username: acc.username,
      student,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
