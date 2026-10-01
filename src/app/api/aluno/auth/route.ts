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

      // Próxima ordem de inscrição (fonte da verdade da matrícula CCLN-XXX)
      const { data: maxRow } = await supabaseAdmin
        .from('students').select('ordem_inscricao')
        .not('ordem_inscricao', 'is', null)
        .order('ordem_inscricao', { ascending: false }).limit(1).maybeSingle();
      const ordem = (maxRow?.ordem_inscricao ?? 0) + 1;

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

      // Backup de alunos + auditoria
      try {
        const { autoBackupAfterChange } = await import('@/lib/backupAlunos');
        await autoBackupAfterChange(`responsavel:${novaLinha.id}`, 'inscricao');
      } catch { /* não bloqueia */ }
      await appendAudit({
        actor: novaLinha.id, actor_type: 'student', action: 'conta_responsavel_criada',
        target_id: novaLinha.id, target_name: nomeTrim,
        details: { email: emailNorm, cpf: `***${cpfDigitsIn.slice(-2)}`, sem_perfil_aluno: true },
      });

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
