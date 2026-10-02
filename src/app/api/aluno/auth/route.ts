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
import { PROFILE_COOKIE, profileCookieOptions } from '@/lib/ator';
import { appendAudit } from '@/lib/audit';
import { idadeEm, faixaCadastro, mensagemFaixa } from '@/lib/idade';

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
  pending_otp?: string; // legado: contas antigas podiam nascer inativas aguardando validação
  otp_expires?: string;
  otp_purpose?: 'reset';
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

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/* ── E-mail OTP de 6 dígitos (recuperação de senha) ───────────────────────── */

function gerarOtp(): string { return String(Math.floor(100000 + Math.random() * 900000)); }
const generateOTP = gerarOtp; // nome usado pelos fluxos de registro restaurados

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

    /* ── LOGOUT — limpa TODOS os cookies no servidor (sessão + perfil ativo) ── */
    if (action === 'logout') {
      const store = await cookies();
      store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
      // O contexto "Quem está usando?" NUNCA sobrevive à saída — sem isso, o
      // próximo login desta conta abriria o perfil aberto pela conta anterior.
      store.set(PROFILE_COOKIE, '', { ...profileCookieOptions(), maxAge: 0 });
      try {
        const sessSaindo = readAlunoSessionFromReq(req);
        if (sessSaindo) {
          await appendAudit({ actor: sessSaindo.un || sessSaindo.sid, actor_type: 'student', action: 'aluno_logout', target_id: sessSaindo.sid });
        }
      } catch {}
      return NextResponse.json({ success: true });
    }

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

    if (action === 'register') {
      // Support both student_id (legacy) and cpf/documento (self-registration)
      let { student_id, username, email, password, phone, cpf_or_doc } = body;
      const dataNascimentoIn: string = typeof body.data_nascimento === 'string' ? body.data_nascimento : '';
      const dataNascLimpa = dataNascimentoIn ? dataNascimentoIn.slice(0, 10) : '';

      // ── Validate required fields ──────────────────────────────────────────
      if (!username || !password) {
        return NextResponse.json({ error: 'Usuário e senha são obrigatórios.' }, { status: 400 });
      }
      if (password.length < 6) {
        return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      }
      // Email is required
      if (!email || !email.trim()) {
        return NextResponse.json({ error: 'E-mail é obrigatório.' }, { status: 400 });
      }
      const emailNorm = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailNorm)) {
        return NextResponse.json({ error: 'Formato de e-mail inválido.' }, { status: 400 });
      }

      // ── CPF format validation helper ──────────────────────────────────────
      function isValidCPF(cpf: string): boolean {
        const d = cpf.replace(/\D/g, '');
        if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
        let sum = 0;
        for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
        let r = (sum * 10) % 11;
        if (r === 10 || r === 11) r = 0;
        if (r !== parseInt(d[9])) return false;
        sum = 0;
        for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
        r = (sum * 10) % 11;
        if (r === 10 || r === 11) r = 0;
        return r === parseInt(d[10]);
      }

      // ── Look up student — by cpf_or_doc or student_id ────────────────────
      let student: { id: string; nome_completo: string; telefone?: string | null; email?: string | null } | null = null;

      if (cpf_or_doc) {
        const inputDigits = (cpf_or_doc as string).replace(/\D/g, '');
        const inputRaw = (cpf_or_doc as string).replace(/\s/g, '').toLowerCase();

        // If looks like CPF (11 digits), validate checksum
        if (inputDigits.length === 11 && !isValidCPF(inputDigits)) {
          return NextResponse.json({ error: 'CPF inválido. Verifique os dígitos informados.' }, { status: 400 });
        }

        const { data: allStudents } = await supabaseAdmin
          .from('students')
          .select('id, nome_completo, telefone, email, cpf, identidade');

        const found = (allStudents || []).find(s => {
          const storedCpf = (s.cpf || '').replace(/\D/g, '');
          const storedIdDigits = (s.identidade || '').replace(/\D/g, '').toLowerCase();
          const storedIdRaw = (s.identidade || '').replace(/\s/g, '').toLowerCase();
          if (inputDigits.length >= 11 && storedCpf === inputDigits) return true;
          if (inputRaw && (storedIdRaw === inputRaw || (storedIdDigits && storedIdDigits === inputDigits))) return true;
          return false;
        });
        if (!found) {
          return NextResponse.json({
            error: 'Nenhum aluno encontrado com esse CPF/documento. Verifique se seu cadastro foi realizado pela associação.',
            hint: 'nome', // hint to frontend to try name-based search
          }, { status: 404 });
        }
        student = found;
        student_id = found.id;
      } else {
        if (!student_id) {
          return NextResponse.json({ error: 'Informe seu CPF, número do documento ou o ID fornecido pelo administrador.' }, { status: 400 });
        }
        const { data: s } = await supabaseAdmin
          .from('students')
          .select('id, nome_completo, telefone, email')
          .eq('id', student_id)
          .maybeSingle();
        if (!s) {
          return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
        }
        student = s;
      }

      if (!student) {
        return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
      }

      // ── GATE DE IDADE (configuração central em src/lib/idade.ts) ─────────
      // A idade SEMPRE vem da data de nascimento real armazenada — nunca de
      // um campo "idade" informado pelo usuário.
      let dataNascFinal = dataNascLimpa;
      if (!dataNascFinal) {
        const { data: stNasc } = await supabaseAdmin
          .from('students').select('data_nascimento').eq('id', (student_id as string)).maybeSingle();
        dataNascFinal = String(stNasc?.data_nascimento || '').slice(0, 10);
      }
      if (dataNascLimpa && student_id) {
        // Recalcula a menoridade SEMPRE pela data real — nunca confia na flag antiga
        const idadeDoc = idadeEm(dataNascLimpa);
        await supabaseAdmin.from('students')
          .update({ data_nascimento: dataNascLimpa, menor_de_idade: idadeDoc >= 0 ? idadeDoc < 18 : false })
          .eq('id', (student_id as string));
      }
      const idadeCadastro = idadeEm(dataNascFinal);
      if (idadeCadastro >= 0 && faixaCadastro(idadeCadastro) === 'bloqueado') {
        return NextResponse.json({
          error: mensagemFaixa('bloqueado'),
          codigo: 'menor_de_15',
        }, { status: 422 });
      }

      const authMap = await loadAuthMap();

      // ── Duplicate checks ──────────────────────────────────────────────────
      if (authMap[student_id]) {
        const existing = authMap[student_id];
        if (existing.active) {
          // Active account: check if the phone in students table differs from stored phone.
          // If admin corrected the phone, we need to detect it and invalidate the old validation.
          const { data: freshStudent } = await supabaseAdmin
            .from('students').select('telefone').eq('id', student_id).maybeSingle();
          const freshPhoneDigits = ((freshStudent?.telefone || '').replace(/\D/g, ''));
          const freshPhoneNorm = freshPhoneDigits ? (freshPhoneDigits.startsWith('55') ? freshPhoneDigits : `55${freshPhoneDigits}`) : '';
          const storedPhoneDigits = (existing.phone || '').replace(/\D/g, '');
          const phoneWasCorrected = freshPhoneNorm && storedPhoneDigits && freshPhoneNorm !== storedPhoneDigits;

          if (phoneWasCorrected) {
            // Admin corrected the phone — reset validation status so student can re-register
            authMap[student_id] = { ...existing, active: false, phone: freshPhoneNorm, pending_otp: undefined, otp_expires: undefined };
            await saveAuthMap(authMap);
            // Fall through — will proceed to overwrite with new registration below
          } else {
            return NextResponse.json({ error: 'Este aluno já possui uma conta. Use a opção de recuperar senha caso tenha esquecido o acesso.' }, { status: 409 });
          }
        }
        // Inactive account (pending OTP): allow overwrite so student can re-register with corrected phone/data
        // (fall through — will overwrite the pending account below)
      }

      // Username taken?
      const usernameTaken = Object.values(authMap).find(
        a => a.username.toLowerCase() === username.trim().toLowerCase()
      );
      if (usernameTaken) {
        return NextResponse.json({ error: 'Este nome de usuário já está em uso. Escolha outro.' }, { status: 409 });
      }

      // Email taken?
      const emailTaken = Object.values(authMap).find(
        a => a.email && a.email.toLowerCase() === emailNorm
      );
      if (emailTaken) {
        return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
      }

      // ── Normalize phone ───────────────────────────────────────────────────
      const rawPhone = (phone || student.telefone || '').replace(/\D/g, '');
      const phone_to_use = rawPhone ? (rawPhone.startsWith('55') ? rawPhone : `55${rawPhone}`) : '';

      const salt = generateSalt();
      const password_hash = hashPassword(password, salt);
      const otp = generateOTP();
      const finalEmail = emailNorm || student.email || '';

      const account: AlunoAccount = {
        student_id,
        username: username.trim().toLowerCase(),
        email: finalEmail,
        password_hash,
        salt,
        active: true, // activate immediately — no OTP required
        phone: phone_to_use,
        created_at: new Date().toISOString(),
      };

      authMap[student_id] = account;
      await saveAuthMap(authMap);

      // ── Sync email to students table ──────────────────────────────────────
      if (finalEmail) {
        try {
          await supabaseAdmin.from('students').update({ email: finalEmail }).eq('id', student_id);
        } catch { /* column may not exist yet — silent fail */ }
      }

      // Já nasce logado: cookie de sessão + dados do aluno
      const { data: studentData } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, nucleo, graduacao, tipo_graduacao, foto_url, apelido, nome_social')
        .eq('id', student_id)
        .maybeSingle();

      // ID sequencial de chegada (CCLN-000) — garante que toda conta tenha um
      const { data: idData } = await supabaseAdmin
        .from('students').select('ordem_inscricao').eq('id', student_id).maybeSingle();
      let inscricao_numero: number | null = idData?.ordem_inscricao ?? null;
      if (inscricao_numero == null) {
        const { data: maxRow } = await supabaseAdmin
          .from('students')
          .select('ordem_inscricao')
          .not('ordem_inscricao', 'is', null)
          .order('ordem_inscricao', { ascending: false })
          .limit(1)
          .maybeSingle();
        inscricao_numero = (maxRow?.ordem_inscricao ?? 0) + 1;
        await supabaseAdmin.from('students')
          .update({ ordem_inscricao: inscricao_numero })
          .eq('id', student_id);
      }
      const store = await cookies();
      const sess = createAlunoSession(student_id, account.username);
      store.set(SESSION_COOKIE, serializeAlunoSession(sess), sessionCookieOptions());

      return NextResponse.json({
        success: true,
        logged_in: true,
        student_id,
        student_name: student.nome_completo.split(' ')[0],
        student: studentData,
        inscricao_numero,
      });
    }

    // ── REGISTER: CONTA DE RESPONSÁVEL (sem perfil de aluno) ─────────────────
    // Cria a linha em students marcada com conta_tipo='responsavel' — não é
    // aluno: some das listas de alunos via filtro no cliente e nas rotas
    // administrativas; guarda presença/graduação bloqueadas no servidor.
    if (action === 'register-responsavel') {
      const nomeTrim = String(body.nome_completo || '').trim().replace(/\s+/g, ' ');
      const emailNorm = String(body.email || '').trim().toLowerCase();
      const senha = String(body.password || '');
      const cpfDigitsIn = String(body.cpf || '').replace(/\D/g, '');
      const dataNasc = String(body.data_nascimento || '').slice(0, 10);
      const phoneIn = String(body.phone || '').replace(/\D/g, '');

      if (nomeTrim.split(' ').filter(Boolean).length < 2) {
        return NextResponse.json({ error: 'Informe seu nome completo.' }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
      }
      if (senha.length < 6) {
        return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      }
      if (cpfDigitsIn.length !== 11) {
        return NextResponse.json({ error: 'O CPF é obrigatório para a conta de responsável.' }, { status: 400 });
      }
      if (!dataNasc) {
        return NextResponse.json({ error: 'Informe a data de nascimento.' }, { status: 400 });
      }
      const { isValidCPF } = await import('@/lib/studentCompliance');
      if (!isValidCPF(cpfDigitsIn)) {
        return NextResponse.json({ error: 'CPF inválido — verifique os dígitos informados.' }, { status: 400 });
      }
      if (idadeEm(dataNasc) < 18) {
        return NextResponse.json({ error: 'Função de responsável indisponível: é necessário ter 18 anos ou mais.' }, { status: 422 });
      }

      const authMap0 = await loadAuthMap();
      // CPF e e-mail únicos entre todas as contas do app
      const { data: todosStudents } = await supabaseAdmin.from('students').select('id, cpf, email');
      const sameCpf = (todosStudents || []).some(s => String((s as { cpf?: string }).cpf || '').replace(/\D/g, '') === cpfDigitsIn);
      if (sameCpf) return NextResponse.json({ error: 'Este CPF já está cadastrado. Use "Esqueci minha senha" para recuperar o acesso.' }, { status: 409 });
      if (Object.values(authMap0).some(a => a.email?.toLowerCase() === emailNorm)) {
        return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
      }

      // Matrícula CCLN só para quem é aluno. Conta SÓ-responsável não ganha
      // matrícula (não é aluno) — o campo fica nulo e as telas tratam null.
      let ordem: number | null = null;
      if (body.tambem_aluno === true) {
        const { data: maxRow } = await supabaseAdmin
          .from('students').select('ordem_inscricao')
          .not('ordem_inscricao', 'is', null)
          .order('ordem_inscricao', { ascending: false }).limit(1).maybeSingle();
        ordem = (maxRow?.ordem_inscricao ?? 0) + 1;
      }

      const salt = generateSalt();
      const account: AlunoAccount = {
        student_id: '', // preenchido após criar a linha
        username: emailNorm,
        email: emailNorm,
        password_hash: hashPassword(senha, salt),
        salt,
        active: true,
        phone: phoneIn ? (phoneIn.startsWith('55') ? phoneIn : `55${phoneIn}`) : '',
        created_at: new Date().toISOString(),
      };

      const linha: Record<string, unknown> = {
        nome_completo: nomeTrim,
        cpf: cpfDigitsIn,
        identidade: '',
        email: emailNorm,
        telefone: account.phone || '',
        data_nascimento: dataNasc,
        conta_tipo: body.tambem_aluno === true ? 'responsavel_aluno' : 'responsavel',
        ordem_inscricao: ordem,
        graduacao: '',
        tipo_graduacao: 'corda',
        menor_de_idade: false,
      };
      const placeholdersR: Record<string, unknown> = {
        cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
        nome_pai: '', nome_mae: '', nome_responsavel: '', cpf_responsavel: '',
        apelido: '', nome_social: '', sexo: '', nucleo: '',
      };
      let novaLinha: { id: string } | null = null;
      let payloadR: Record<string, unknown> = linha;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabaseAdmin.from('students').insert(payloadR).select('id').single();
        if (!error && data) { novaLinha = data as { id: string }; break; }
        if (error && /null value|not-null|NOT NULL/i.test(error.message || '')) {
          payloadR = { ...placeholdersR, ...linha };
          continue;
        }
        return NextResponse.json({ error: error?.message || 'Erro ao criar a conta.' }, { status: 500 });
      }
      if (!novaLinha) return NextResponse.json({ error: 'Erro ao criar a conta.' }, { status: 500 });

      // Ativa o perfil de responsável (tabela guardians) para esta linha
      const { error: gErr } = await supabaseAdmin
        .from('guardians').upsert({ student_id: novaLinha.id, cpf_digits: cpfDigitsIn }, { onConflict: 'student_id' });
      if (gErr) {
        return NextResponse.json({ error: 'Conta criada, mas o perfil de responsável falhou. Procure o admin do seu núcleo.' }, { status: 500 });
      }

      // Conta de login (mesmo mapa de auth; student_id = linha responsável)
      account.student_id = novaLinha.id;
      authMap0[novaLinha.id] = account;
      await saveAuthMap(authMap0);

      // Notificação de segurança: conta criada (categoria obrigatória)
      try {
        const { notificarSeguranca } = await import('@/lib/push/integracoes');
        await notificarSeguranca(novaLinha.id, 'Conta criada', 'Sua conta de responsável foi criada. Se não foi você, procure o admin do seu núcleo.', 'conta_criada');
      } catch { /* best-effort */ }

      // Conta de responsável não entra na numeração de alunos — não força backup
      // da base de alunos nem relatório de inscrição (não é matrícula).
      try {
        await appendAudit({
          actor: novaLinha.id, actor_type: 'student', action: 'conta_responsavel_criada',
          target_id: novaLinha.id, target_name: nomeTrim,
          details: { email: emailNorm, cpf: `***${cpfDigitsIn.slice(-2)}`, com_perfil_aluno: body.tambem_aluno === true },
        });
      } catch { /* não bloqueia */ }

      // Já nasce logado
      const store = await cookies();
      store.set(SESSION_COOKIE, serializeAlunoSession(createAlunoSession(novaLinha.id, account.username)), sessionCookieOptions());
      return NextResponse.json({
        success: true, logged_in: true, student_id: novaLinha.id,
        student_name: nomeTrim.split(' ')[0],
        conta_tipo: 'responsavel',
      });
    }

    // ── REGISTER BY NAME (fallback when CPF not in DB) ────────────────────────
    if (action === 'register-by-name') {
      const { nome_completo, email, password } = body;
      if (!nome_completo || !email || !password) {
        return NextResponse.json({ error: 'Nome, e-mail e senha são obrigatórios.' }, { status: 400 });
      }
      if (password.length < 6) {
        return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      }
      const emailNorm = email.trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailNorm)) {
        return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
      }
      const dataNascimentoIn: string = typeof body.data_nascimento === 'string' ? body.data_nascimento : '';
      const dataNascLimpa = dataNascimentoIn ? dataNascimentoIn.slice(0, 10) : '';
      // A data de nascimento é obrigatória para aplicar as regras de idade
      if (!dataNascLimpa || isNaN(new Date(`${dataNascLimpa}T12:00:00`).getTime()) || dataNascLimpa > new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ error: 'Informe uma data de nascimento válida.' }, { status: 400 });
      }
      const idadeCadastro = idadeEm(dataNascLimpa);
      if (idadeCadastro >= 0 && faixaCadastro(idadeCadastro) === 'bloqueado') {
        return NextResponse.json({
          error: mensagemFaixa('bloqueado'),
          codigo: 'menor_de_15',
        }, { status: 422 });
      }

      // Normalize name for matching
      const normalizeName = (s: string) =>
        s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const normInput = normalizeName(nome_completo);

      const { data: allStudents } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, telefone, email, cpf');

      const existing = (allStudents || []).find(s =>
        normalizeName(s.nome_completo || '') === normInput
      );

      // Self-service: aluno novo tem o cadastro criado na hora da criação da conta
      type StudentRef = { id: string; nome_completo: string; telefone: string | null; email: string | null; cpf: string | null };
      let target: StudentRef | null = existing ?? null;
      if (!target) {
        const nomeTrim = nome_completo.trim().replace(/\s+/g, ' ');
        if (nomeTrim.split(' ').filter(Boolean).length < 2) {
          return NextResponse.json({ error: 'Informe seu nome completo (nome e sobrenome).' }, { status: 400 });
        }
        const cpfIn = typeof body.cpf_or_doc === 'string' && body.cpf_or_doc.trim() ? body.cpf_or_doc.trim() : null;
        const phoneIn = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
        const base: Record<string, unknown> = { nome_completo: nomeTrim, email: emailNorm, data_nascimento: dataNascLimpa, menor_de_idade: idadeCadastro < 18 };
        if (cpfIn) base.cpf = cpfIn;
        if (phoneIn) base.telefone = phoneIn;
        // Placeholders para colunas legadas com NOT NULL (mesma estratégia de /api/inscricao)
        const placeholders: Record<string, unknown> = {
          cpf: cpfIn || '', identidade: '', data_nascimento: dataNascLimpa,
          telefone: phoneIn || '', cep: '', endereco: '', numero: '', complemento: '',
          bairro: '', cidade: '', estado: '', graduacao: 'Cru', tipo_graduacao: 'corda',
          nucleo: '', nome_pai: '', nome_mae: '', nome_responsavel: '', cpf_responsavel: '',
          apelido: '', nome_social: '', sexo: '',
        };
        let payload: Record<string, unknown> = { ...base };
        for (let attempt = 0; attempt < 2; attempt++) {
          const { data, error } = await supabaseAdmin
            .from('students').insert(payload)
            .select('id, nome_completo, telefone, email, cpf')
            .single();
          if (!error && data) { target = data as StudentRef; break; }
          if (error && /null value|not-null|NOT NULL/i.test(error.message || '')) {
            payload = { ...placeholders, ...base }; // retry preenchendo NOT NULLs legados
            continue;
          }
          return NextResponse.json({ error: error?.message || 'Erro ao criar seu cadastro.' }, { status: 500 });
        }
        if (!target) {
          return NextResponse.json({ error: 'Erro ao criar seu cadastro. Tente novamente.' }, { status: 500 });
        }
      }

      const authMap = await loadAuthMap();
      if (authMap[target.id]) {
        const existingByName = authMap[target.id];
        // Allow re-registration only if account is inactive (pending OTP) — phone may have been corrected
        if (existingByName.active) {
          return NextResponse.json({ error: 'Este aluno já possui uma conta. Use recuperar senha.' }, { status: 409 });
        }
        // Inactive: fall through to overwrite
      }
      // Mantém a data de nascimento real atualizada (regras de idade usam a data armazenada)
      if (existing) {
        try {
          await supabaseAdmin.from('students')
            .update({ data_nascimento: dataNascLimpa, menor_de_idade: idadeCadastro < 18 })
            .eq('id', target.id);
        } catch { /* coluna pode não existir */ }
      }
      const emailTaken = Object.values(authMap).find(a => a.email && a.email.toLowerCase() === emailNorm);
      if (emailTaken) {
        return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
      }

      const salt = generateSalt();
      const password_hash = hashPassword(password, salt);
      const account: AlunoAccount = {
        student_id: target.id,
        username: emailNorm,
        email: emailNorm,
        password_hash,
        salt,
        active: true, // auto-activate — no WhatsApp required
        created_at: new Date().toISOString(),
      };
      authMap[target.id] = account;
      await saveAuthMap(authMap);

      // Sync email to students table
      try { await supabaseAdmin.from('students').update({ email: emailNorm }).eq('id', target.id); } catch { /* silent */ }

      // ID sequencial de chegada (CCLN-000) — garante que toda conta tenha um
      const { data: idRow } = await supabaseAdmin
        .from('students').select('ordem_inscricao').eq('id', target.id).maybeSingle();
      let inscricao_numero: number | null = idRow?.ordem_inscricao ?? null;
      if (inscricao_numero == null) {
        const { data: maxRow } = await supabaseAdmin
          .from('students')
          .select('ordem_inscricao')
          .not('ordem_inscricao', 'is', null)
          .order('ordem_inscricao', { ascending: false })
          .limit(1)
          .maybeSingle();
        inscricao_numero = (maxRow?.ordem_inscricao ?? 0) + 1;
        await supabaseAdmin.from('students')
          .update({ ordem_inscricao: inscricao_numero })
          .eq('id', target.id);
      }

      const { data: student } = await supabaseAdmin
        .from('students').select('id, nome_completo, nucleo, graduacao, tipo_graduacao, foto_url, apelido, nome_social')
        .eq('id', target.id).maybeSingle();

      // Já nasce logado: cookie de sessão
      const store = await cookies();
      const sess = createAlunoSession(target.id, emailNorm);
      store.set(SESSION_COOKIE, serializeAlunoSession(sess), sessionCookieOptions());

      return NextResponse.json({ success: true, logged_in: true, student_id: target.id, username: emailNorm, student, student_name: (target.nome_completo || nome_completo).split(' ')[0], inscricao_numero });
    }

    /* ── EXCLUIR CONTA DE ACESSO (exclusivo do painel) ────────────────────── */
    // Usada pela aba Contas do painel ("Excluir Conta Definitivamente"). Remove
    // login/senha/dispositivos; a linha do cadastro permanece (Alunos continua
    // exibindo o histórico). Se a conta tinha dependentes ativos, passa a valer
    // "só responsável" (sem acesso) em vez de voltar a aparecer como aluno.
    if (action === 'admin-delete-account') {
      const painel = readPanelSession(req);
      if (!painel) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
      const alvoId = String(body.student_id || '');
      if (!alvoId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });

      const authMap = await loadAuthMap();
      const acc = authMap[alvoId];
      if (!acc) return NextResponse.json({ error: 'Conta de acesso não encontrada. Ela já deve ter sido excluída.' }, { status: 404 });

      let reclassificadoComo: string | null = null;
      try {
        const { tutoradosDoResponsavel } = await import('@/lib/guardians');
        const tuts = await tutoradosDoResponsavel(alvoId);
        if ((tuts || []).some(t => t.status_vinculo === 'active')) {
          await supabaseAdmin.from('students').update({ conta_tipo: 'responsavel' }).eq('id', alvoId);
          reclassificadoComo = 'responsavel';
        } else {
          await supabaseAdmin.from('students').update({ conta_tipo: null }).eq('id', alvoId);
        }
      } catch { /* sem vínculos */ }

      delete authMap[alvoId];
      await saveAuthMap(authMap);

      try {
        await supabaseAdmin.from('push_subscriptions').delete().eq('user_id', alvoId);
        await supabaseAdmin.from('notification_preferences').delete().eq('user_id', alvoId);
      } catch { /* melhor-esforço */ }

      try {
        await appendAudit({ actor: painel.u, actor_type: 'admin', action: 'conta_aluno_excluida_painel', target_id: alvoId });
      } catch {}

      return NextResponse.json({ success: true, reclassificado_como: reclassificadoComo });
    }

    // ── ACCOUNT STATUS (Responsáveis & Perfis) ────────────────────────────────
    // Fonte do card "Responsáveis & Perfis": faixa de idade, autorização de
    // adolescente (15–17), perfil de responsável, tutelados e solicitações.
    if (action === 'account-status') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

      const { data: st } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, data_nascimento, foto_url, nucleo, graduacao, menor_de_idade, assinatura_responsavel, conta_tipo')
        .eq('id', sess.sid)
        .maybeSingle();
      if (!st) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });

      const idade = idadeEm(st.data_nascimento || '');
      const faixa = idade >= 0 ? faixaCadastro(idade) : 'independente';

      const { data: authz } = await supabaseAdmin
        .from('adolescent_authorizations')
        .select('status')
        .eq('student_id', sess.sid)
        .maybeSingle();

      const { data: perfilResp } = await supabaseAdmin
        .from('guardians')
        .select('student_id, criado_em')
        .eq('student_id', sess.sid)
        .maybeSingle();

      const ehAdulto = idade >= 18 || idade < 0;
      // Autorização exigida apenas para contas próprias de 15–17
      const autorizacaoStatus: 'necessaria_pendente' | 'autorizado' | 'revogado' | 'desnecessaria' =
        faixa === 'precisa_autorizacao'
          ? (authz?.status === 'authorized' ? 'autorizado' : authz?.status === 'revoked' ? 'revogado' : 'necessaria_pendente')
          : 'desnecessaria';

      // Conta liberada = adulto OU 15-17 com autorização authorized
      const liberada = faixa === 'independente' || autorizacaoStatus === 'autorizado';
      // O acesso do app continua valendo enquanto a autorização não for revogada
      const acessoAtivo = autorizacaoStatus !== 'revogado';

      let perfil_responsavel: { ativo: boolean; vinculos_ativos: number } | null = null;
      if (perfilResp) {
        const { count } = await supabaseAdmin
          .from('guardian_links')
          .select('id', { count: 'exact', head: true })
          .eq('guardian_student_id', sess.sid)
          .eq('status', 'active');
        perfil_responsavel = { ativo: true, vinculos_ativos: count ?? 0 };
      }

      const { tutoradosDoResponsavel, vinculosPendentesDoAluno } = await import('@/lib/guardians');
      const tuts = perfilResp ? await tutoradosDoResponsavel(sess.sid) : [];
      const pendentes = await vinculosPendentesDoAluno(sess.sid);

      return NextResponse.json({
        student_id: sess.sid,
        idade,
        faixa,
        eh_adulto: ehAdulto,
        maior_de_idade: ehAdulto,
        conta_tipo: st.conta_tipo || 'aluno',
        autorizacao_status: autorizacaoStatus,
        conta_liberada: liberada,
        acesso_ativo: acessoAtivo,
        pode_ser_responsavel: ehAdulto,
        perfil_responsavel,
        tutelados: tuts,
        vinculos_pendentes_recebidos: pendentes,
        authz: authz || null,
      });
    }

    // ── ATIVAR PERFIL DE RESPONSÁVEL (18+, mesma conta) ──────────────────────
    if (action === 'become-guardian') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const cpf = String(body.cpf || '');
      const { criarPerfilResponsavel } = await import('@/lib/guardians');
      const r = await criarPerfilResponsavel(sess.sid, cpf);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      await appendAudit({
        actor: sess.sid, actor_type: 'student', action: 'responsavel_perfil_ativado', target_id: sess.sid,
      });
      return NextResponse.json({ success: true });
    }

    // ── GERAR CÓDIGO DE VÍNCULO DO ALUNO (prova de contato) ─────────────────
    if (action === 'link-code') {
      const sess = readAlunoSessionFromReq(req);
      const painel = readPanelSession(req);
      if (!sess && !painel) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const studentId = String(body.student_id || sess?.sid || '');
      if (!studentId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
      // Aluno só gera o próprio código; painel gera de qualquer aluno que vê
      if (!painel && studentId !== sess?.sid) {
        return NextResponse.json({ error: 'Você só pode gerar o seu próprio código.' }, { status: 403 });
      }
      const { publicarCodigoDoAluno } = await import('@/lib/guardians');
      const r = await publicarCodigoDoAluno(studentId);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 404 });
      return NextResponse.json({ success: true, codigo: r.codigo, expira_em: r.expira_em });
    }

    // ── VÍNCULO: responsável informa código + matrícula ─────────────────────
    if (action === 'link-guardian') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const codigo = String(body.codigo || '');
      const matricula = String(body.matricula || '');
      const relacao = String(body.relacao || 'responsavel_legal');

      const { consumirCodigoVinculo, criarVinculo } = await import('@/lib/guardians');
      const { data: gRow } = await supabaseAdmin.from('guardians').select('student_id').eq('student_id', sess.sid).maybeSingle();
      if (!gRow) return NextResponse.json({ error: 'Ative o perfil de responsável antes de adicionar tutelados.' }, { status: 422 });

      const valido = await consumirCodigoVinculo(codigo, matricula);
      if (!valido.ok) return NextResponse.json({ error: valido.error }, { status: 422 });
      if (valido.student_id === sess.sid) {
        return NextResponse.json({ error: 'Você não pode se adicionar como tutelado.' }, { status: 422 });
      }
      const vinc = await criarVinculo(sess.sid, String(valido.student_id), relacao, { viaPainel: false });
      if (!vinc.ok) return NextResponse.json({ error: vinc.error }, { status: 422 });
      await appendAudit({
        actor: sess.sid, actor_type: 'student', action: 'vinculo_solicitado',
        target_id: String(valido.student_id), target_name: valido.nome_aluno,
        details: { relacao, status: vinc.status },
      });
      return NextResponse.json({
        success: true,
        status: vinc.status,
        nome_aluno: valido.nome_aluno,
        aguardando_aluno: vinc.status === 'pending',
        mensagem: vinc.status === 'pending'
          ? 'Solicitação registrada. O aluno precisa autorizar o acesso no app dele.'
          : 'Vínculo ativo.',
      });
    }

    // ── ALUNO decide solicitação de vínculo recebida ─────────────────────────
    if (action === 'link-decide') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const guardianId = String(body.guardian_student_id || '');
      const aprovar = !!body.aprovar;
      const { alunoDecideVinculoPendente } = await import('@/lib/guardians');
      const r = await alunoDecideVinculoPendente(sess.sid, guardianId, aprovar);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      await appendAudit({
        actor: sess.sid, actor_type: 'student',
        action: aprovar ? 'vinculo_aprovado' : 'vinculo_rejeitado',
        target_id: guardianId,
      });
      return NextResponse.json({ success: true });
    }

    // ── REVOGAR vínculo (responsável ou aluno) ───────────────────────────────
    if (action === 'link-revoke') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const guardianId = String(body.guardian_student_id || sess.sid);
      const studentId = String(body.student_id || sess.sid);
      const { revogarVinculo, podeAgirComo } = await import('@/lib/guardians');
      // Quem revoga: o próprio responsável (guardian) ou o aluno com vínculo ativo
      const ehGuardian = guardianId === sess.sid;
      const ehAlunoVinculado = studentId === sess.sid || (await podeAgirComo(sess.sid, studentId));
      if (!ehGuardian && !ehAlunoVinculado) {
        return NextResponse.json({ error: 'Sem permissão para revogar este vínculo.' }, { status: 403 });
      }
      const r = await revogarVinculo(guardianId, studentId, `aluno:${sess.sid}`, String(body.motivo || ''));
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 422 });
      await appendAudit({
        actor: sess.sid, actor_type: 'student', action: 'vinculo_revogado',
        target_id: studentId, details: { por: ehGuardian ? 'responsavel' : 'aluno' },
      });
      return NextResponse.json({ success: true });
    }

    // ── CADASTRAR TUTELADO NOVO (responsável cadastra a criança do zero) ────
    // Cria o perfil de aluno SEM CONTA (a criança nunca recebe login) e já
    // nasce vinculado ao responsável (ativo). Matrícula segue a ordem oficial.
    if (action === 'criar-tutelado') {
      const sessT = readAlunoSessionFromReq(req);
      if (!sessT) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const nomeTrim = String(body.nome_completo || '').trim().replace(/\s+/g, ' ');
      const dataNasc = String(body.data_nascimento || '').slice(0, 10);
      const cpfIn = String(body.cpf || '').replace(/\D/g, '');
      const nucleo = String(body.nucleo || '').trim();
      const relacao = String(body.relacao || 'responsavel_legal');
      const graduacao = String(body.graduacao || 'Cru');

      if (!sessT.sid) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const { data: gPerfil } = await supabaseAdmin.from('guardians').select('student_id').eq('student_id', sessT.sid).maybeSingle();
      if (!gPerfil) return NextResponse.json({ error: 'Ative o perfil de responsável antes de cadastrar um tutelado.' }, { status: 422 });
      if (nomeTrim.split(' ').filter(Boolean).length < 2) {
        return NextResponse.json({ error: 'Informe o nome completo do tutelado.' }, { status: 400 });
      }
      if (!dataNasc || isNaN(new Date(`${dataNasc}T12:00:00`).getTime()) || dataNasc > new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ error: 'Informe uma data de nascimento válida.' }, { status: 400 });
      }
      const { isValidCPF } = await import('@/lib/studentCompliance');
      if (cpfIn && !isValidCPF(cpfIn)) {
        return NextResponse.json({ error: 'CPF do tutelado inválido.' }, { status: 400 });
      }

      const idadeT = idadeEm(dataNasc);
      if (idadeT >= 15) {
        return NextResponse.json({
          error: 'A partir de 15 anos a pessoa pode (e deve) criar a própria conta. Use "Adicionar tutelado" com o código do aluno para adolescentes que já têm cadastro.',
        }, { status: 422 });
      }

      // Núcleo deve existir na tabela tenants (fonte da verdade)
      let tenantNome = '';
      let tenantId = '';
      if (nucleo) {
        const { data: tenant } = await supabaseAdmin.from('tenants').select('id, nome').eq('id', nucleo).maybeSingle();
        if (!tenant) return NextResponse.json({ error: 'Núcleo informado não foi encontrado.' }, { status: 400 });
        tenantNome = tenant.nome || '';
        tenantId = tenant.id;
      }

      // Próxima ordem de inscrição (fonte da verdade da matrícula CCLN-XXX)
      const { data: maxRow } = await supabaseAdmin
        .from('students').select('ordem_inscricao')
        .not('ordem_inscricao', 'is', null)
        .order('ordem_inscricao', { ascending: false }).limit(1).maybeSingle();
      const proximaOrdem = (maxRow?.ordem_inscricao ?? 0) + 1;

      const base: Record<string, unknown> = {
        nome_completo: nomeTrim,
        data_nascimento: dataNasc,
        menor_de_idade: idadeT < 18,
        ordem_inscricao: proximaOrdem,
        graduacao,
        tipo_graduacao: 'corda',
      };
      if (cpfIn) base.cpf = cpfIn;
      if (tenantNome) base.nucleo = tenantNome;
      const placeholders: Record<string, unknown> = {
        cpf: cpfIn, identidade: '', data_nascimento: dataNasc, telefone: '',
        cep: '', endereco: '', numero: '', complemento: '', bairro: '', cidade: '', estado: '',
        nome_pai: '', nome_mae: '', nome_responsavel: '', cpf_responsavel: '',
        apelido: '', nome_social: '', sexo: '', nucleo: tenantNome,
      };

      let novo: { id: string; nome_completo: string } | null = null;
      let payloadT: Record<string, unknown> = { ...base };
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabaseAdmin
          .from('students').insert(payloadT).select('id, nome_completo').single();
        if (!error && data) { novo = data as { id: string; nome_completo: string }; break; }
        if (error && /null value|not-null|NOT NULL/i.test(error.message || '')) {
          payloadT = { ...placeholders, ...base };
          continue;
        }
        return NextResponse.json({ error: error?.message || 'Erro ao cadastrar o tutelado.' }, { status: 500 });
      }
      if (!novo) return NextResponse.json({ error: 'Erro ao cadastrar o tutelado.' }, { status: 500 });

      // Vínculo direto e ativo (o responsável que criou é o declarante)
      const { error: vErr } = await supabaseAdmin.from('guardian_links').insert({
        guardian_student_id: sessT.sid,
        student_id: novo.id,
        relacao,
        status: 'active',
        criado_por: `responsavel:${sessT.sid}`,
        aprovado_em: new Date().toISOString(),
      });
      if (vErr) {
        return NextResponse.json({ error: 'Tutelado cadastrado, mas o vínculo falhou. Procure o admin do seu núcleo.' }, { status: 500 });
      }

      // Backup de alunos dispara como nova inscrição
      try {
        const { autoBackupAfterChange } = await import('@/lib/backupAlunos');
        await autoBackupAfterChange(`responsavel:${sessT.sid}`, 'inscricao');
      } catch { /* não bloqueia */ }

      await appendAudit({
        actor: sessT.sid, actor_type: 'student', action: 'tutelado_cadastrado',
        target_id: novo.id, target_name: novo.nome_completo,
        details: { relacao, nucleo: tenantNome || null, matricula: proximaOrdem, sem_conta: true },
      });

      return NextResponse.json({
        success: true,
        student_id: novo.id,
        nome: novo.nome_completo,
        matricula: `CCLN-${String(proximaOrdem).padStart(3, '0')}`,
        nucleos_ids: tenantId ? [tenantId] : [],
      });
    }

    /* ── LOGIN (usuário/e-mail + senha) ─────────────────────────────────────
       Fluxo para action 'login' (ou sem action). Qualquer outro valor
       desconhecido cai no "Ação desconhecida" no fim — nunca aqui. */
    if (!action || action === 'login') {
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
    }

    /* ── EXCLUIR A PRÓPRIA CONTA (aluno ou responsável, com senha) ─────────── */
    // O cadastro (linha students) NÃO é apagado: histórico, matrícula e vínculos
    // ficam preservados. O que é removido: conta de acesso, cookies, dispositivos
    // push, preferências e a função de responsável (quando a conta não tem
    // dependentes ativos). Usada pelo "Excluir minha conta" do app do aluno.
    if (action === 'delete-account') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const alvoId = String(body.student_id || sess.sid || '');
      if (alvoId !== sess.sid) {
        return NextResponse.json({ error: 'Você só pode excluir a sua própria conta.' }, { status: 403 });
      }
      const senha = String(body.current_password || body.password || '');
      if (!senha) return NextResponse.json({ error: 'Confirme sua senha para excluir.' }, { status: 400 });

      const authMap = await loadAuthMap();
      const acc = authMap[alvoId];
      if (!acc) return NextResponse.json({ error: 'Conta de acesso não encontrada.' }, { status: 404 });
      if (hashPassword(senha, acc.salt) !== acc.password_hash) {
        return NextResponse.json({ error: 'Senha incorreta.' }, { status: 403 });
      }

      // Proteção da família: responsável só exclui a própria função quando não
      // deixa dependente ativo sem gestão. Com dependente(s) ativo(s), a função
      // de responsável permanece (os dados dos tutelados continuam gerenciáveis).
      try {
        const { tutoradosDoResponsavel } = await import('@/lib/guardians');
        const tuts = await tutoradosDoResponsavel(alvoId);
        const temAtivo = (tuts || []).some(t => t.status_vinculo === 'active');
        if (temAtivo) {
          const { desativarPerfilResponsavel } = await import('@/lib/guardians');
          await desativarPerfilResponsavel(alvoId);
        }
      } catch { /* sem perfil de responsável */ }

      delete authMap[alvoId];
      await saveAuthMap(authMap);

      // Limpeza de derivações da conta (tabelas com PK user_id e vínculos)
      try {
        await supabaseAdmin.from('push_subscriptions').delete().eq('user_id', alvoId);
        await supabaseAdmin.from('notification_preferences').delete().eq('user_id', alvoId);
        await supabaseAdmin.from('guardians').delete().eq('student_id', alvoId);
        await supabaseAdmin.from('guardian_links').delete().eq('guardian_student_id', alvoId);
      } catch { /* melhor-esforço */ }

      try {
        await appendAudit({ actor: acc.username || alvoId, actor_type: 'student', action: 'conta_excluida_pelo_titular', target_id: alvoId });
      } catch {}

      const store = await cookies();
      store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
      store.set(PROFILE_COOKIE, '', { ...profileCookieOptions(), maxAge: 0 });

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
