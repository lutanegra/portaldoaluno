import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import { sendEmail, buildOtpHtml, type EmailResult } from '@/lib/email';
import {
  SESSION_COOKIE,
  createAlunoSession,
  serializeAlunoSession,
  verifyAlunoSession,
  sessionCookieOptions,
} from '@/lib/alunoSession';
import { idadeEm, faixaCadastro, mensagemFaixa } from '@/lib/idade';
import { readAlunoSessionFromReq } from '@/lib/alunoSession';
import { readPanelSession } from '@/lib/panelSession';
import { appendAudit } from '@/lib/audit';

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
  username: string; // can be email or custom username
  email?: string;
  password_hash: string; // sha256 of password
  salt: string;
  active: boolean;
  pending_otp?: string; // OTP pendente (reset de senha)
  otp_expires?: string;
  otp_purpose?: 'reset'; // finalidade do OTP pendente
  phone?: string;
  created_at: string;
  last_login?: string;
};

function hashPassword(password: string, salt: string): string {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function loadAuthMap(): Promise<Record<string, AlunoAccount>> {
  try {
    const { data: urlData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(AUTH_KEY, 30);
    if (!urlData?.signedUrl) return {};
    const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveAuthMap(map: Record<string, AlunoAccount>): Promise<void> {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(AUTH_KEY, blob, { upsert: true });
}

// GET /api/aluno/auth - sessão atual via cookie HttpOnly assinado
export async function GET(req: NextRequest) {
  try {
    const store = await cookies();
    const session = verifyAlunoSession(store.get(SESSION_COOKIE)?.value);
    if (!session) return NextResponse.json({ authenticated: false });
    if (req.nextUrl.searchParams.get('action') === 'logout') {
      store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
      return NextResponse.json({ success: true });
    }
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, nucleo, graduacao, tipo_graduacao, foto_url, apelido, nome_social')
      .eq('id', session.sid)
      .maybeSingle();
    if (!student) {
      // Aluno deletado — invalida o cookie
      store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
      return NextResponse.json({ authenticated: false });
    }
    return NextResponse.json({ authenticated: true, session: { student_id: session.sid, username: session.un }, student });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// POST /api/aluno/auth
// Actions: login, register, verify-otp, forgot-password, reset-password, change-password
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    // Logout: limpa o cookie de sessão
    if (action === 'logout') {
      const store = await cookies();
      store.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
      return NextResponse.json({ success: true });
    }


    if (action === 'login') {
      const { username, password } = body;
      if (!username || !password) {
        return NextResponse.json({ error: 'Usuário e senha obrigatórios.' }, { status: 400 });
      }

      const authMap = await loadAuthMap();
      // Find by username or email
      const account = Object.values(authMap).find(
        a => a.username.toLowerCase() === username.toLowerCase() ||
             (a.email && a.email.toLowerCase() === username.toLowerCase())
      );

      if (!account) {
        return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
      }

      if (!account.active) {
        return NextResponse.json({
          error: 'Conta pendente de ativação. Verifique o código enviado no WhatsApp.',
          pending: true,
          phone: account.phone,
          student_id: account.student_id,
        }, { status: 403 });
      }

      const hash = hashPassword(password, account.salt);
      if (hash !== account.password_hash) {
        return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
      }

      // Update last_login
      authMap[account.student_id] = { ...account, last_login: new Date().toISOString() };
      await saveAuthMap(authMap);

      // Get student data (minimal, for session)
      const { data: student } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, nucleo, graduacao, tipo_graduacao, foto_url, apelido, nome_social, data_nascimento')
        .eq('id', account.student_id)
        .maybeSingle();

      // Regras de idade: revogação de autorização bloqueia o login (15–17);
      // pendente entra normalmente — a autorização é concluída dentro do app.
      const idadeLogin = idadeEm(student?.data_nascimento || '');
      if (idadeLogin >= 0 && faixaCadastro(idadeLogin) === 'precisa_autorizacao') {
        const { data: authzL } = await supabaseAdmin
          .from('adolescent_authorizations')
          .select('status')
          .eq('student_id', account.student_id)
          .maybeSingle();
        if (authzL?.status === 'revoked') {
          return NextResponse.json({
            error: 'A autorização do seu responsável foi revogada. Fale com o admin do seu núcleo.',
            codigo: 'autorizacao_revogada',
          }, { status: 403 });
        }
      }

      // Sessão persistente em cookie HttpOnly (30 dias)
      const store = await cookies();
      const sess = createAlunoSession(account.student_id, account.username);
      store.set(SESSION_COOKIE, serializeAlunoSession(sess), sessionCookieOptions());

      return NextResponse.json({
        success: true,
        student_id: account.student_id,
        username: account.username,
        student,
      });
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
        await supabaseAdmin.from('students')
          .update({ data_nascimento: dataNascLimpa, menor_de_idade: idadeEm(dataNascLimpa) >= 0 ? idadeEm(dataNascLimpa) < 18 : false })
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

    if (action === 'verify-otp') {
      const { student_id, otp } = body;
      const authMap = await loadAuthMap();
      const account = authMap[student_id];

      if (!account) {
        return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
      }
      if (account.active) {
        return NextResponse.json({ success: true, message: 'Conta já ativada.' });
      }
      if (!account.pending_otp || account.pending_otp !== otp) {
        return NextResponse.json({ error: 'Código inválido.' }, { status: 400 });
      }
      if (account.otp_expires && new Date(account.otp_expires) < new Date()) {
        return NextResponse.json({ error: 'Código expirado. Solicite um novo.' }, { status: 400 });
      }

      authMap[student_id] = {
        ...account,
        active: true,
        pending_otp: undefined,
        otp_expires: undefined,
      };
      await saveAuthMap(authMap);

      return NextResponse.json({ success: true });
    }

    if (action === 'resend-otp') {
      const { student_id } = body;
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
      if (account.active) return NextResponse.json({ error: 'Conta já ativada.' }, { status: 400 });

      // Always fetch latest phone from students table — admin may have corrected it
      const { data: studentRecord } = await supabaseAdmin
        .from('students').select('nome_completo, telefone').eq('id', student_id).maybeSingle();

      const latestPhoneRaw = (studentRecord?.telefone || account.phone || '').replace(/\D/g, '');
      const latestPhone = latestPhoneRaw ? (latestPhoneRaw.startsWith('55') ? latestPhoneRaw : `55${latestPhoneRaw}`) : '';

      const otp = generateOTP();
      authMap[student_id] = {
        ...account,
        phone: latestPhone || account.phone, // update stored phone to latest
        pending_otp: otp,
        otp_expires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
      await saveAuthMap(authMap);

      let sent = false;
      if (latestPhone) {
        sent = await sendWhatsAppOTP(latestPhone, otp, studentRecord?.nome_completo || 'Aluno');
      }

      return NextResponse.json({
        success: true,
        phone: latestPhone ? `****${latestPhone.slice(-4)}` : null,
        sent,
      });
    }

    if (action === 'forgot-password') {
      const { username_or_email } = body;
      const authMap = await loadAuthMap();
      const account = Object.values(authMap).find(
        a => a.username.toLowerCase() === (username_or_email || '').toLowerCase() ||
             (a.email && a.email.toLowerCase() === (username_or_email || '').toLowerCase())
      );

      if (!account) {
        // Don't reveal if account exists
        return NextResponse.json({ success: true, message: 'Se o usuário existir, você receberá um código.' });
      }

      // Suporta múltiplas contas com o mesmo e-mail: cada student_id tem sua conta.
      const accounts = Object.values(authMap).filter(
        a => a.username.toLowerCase() === (username_or_email || '').toLowerCase() ||
             (a.email && a.email.toLowerCase() === (username_or_email || '').toLowerCase())
      );

      const otp = generateOTP();
      const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      for (const acc of accounts) {
        authMap[acc.student_id] = {
          ...acc,
          pending_otp: otp,
          otp_expires: expires,
          otp_purpose: 'reset',
        };
      }
      await saveAuthMap(authMap);
      const account0 = accounts[0];

        const { data: student } = await supabaseAdmin
        .from('students').select('nome_completo, email, telefone').eq('id', account0.student_id).maybeSingle();
      const studentName = student?.nome_completo || 'Aluno';

      // Envia o código por E-MAIL (canal primário) e WhatsApp como reforço
      const emailAddr = account0.email || student?.email || '';
      const emailResult = emailAddr ? await sendEmailOTP(emailAddr, otp, studentName) : { sent: false, skipped: true };

      let whatsSent = false;
      const phoneRaw = account0.phone || (student?.telefone as string | undefined) || '';
      const phoneDigits = phoneRaw.replace(/\D/g, '');
      if (phoneDigits) {
        whatsSent = await sendWhatsAppOTP(phoneDigits, otp, studentName, true);
      }

      // Sem canal de envio configurado/possível → sinaliza para a tela oferecer o contato do núcleo
      if (!emailResult.sent && !whatsSent) {
        return NextResponse.json({
          success: true,
          send_failed: true,
          message: 'Não foi possível enviar o código agora. Procure o admin do seu núcleo para redefinir a senha.',
        });
      }

      return NextResponse.json({
        success: true,
        student_id: account0.student_id,
        phone: whatsSent ? `****${phoneDigits.slice(-4)}` : null,
        email: emailAddr ? emailAddr.replace(/(.{2}).+(@.+)/, '$1****$2') : null,
        email_sent: emailResult.sent,
        whatsapp_sent: whatsSent,
        message: 'Código enviado.',
      });
    }

    if (action === 'verify-otp-reset') {
      // Verifica o código ANTES de liberar a criação da nova senha
      const { student_id, otp } = body;
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account || !account.pending_otp || account.otp_purpose !== 'reset') {
        return NextResponse.json({ error: 'Solicite um novo código.' }, { status: 400 });
      }
      if (account.pending_otp !== otp) {
        return NextResponse.json({ error: 'Código incorreto. Verifique e tente novamente.' }, { status: 400 });
      }
      if (account.otp_expires && new Date(account.otp_expires) < new Date()) {
        return NextResponse.json({ error: 'Código expirado. Solicite um novo.' }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'reset-password') {
      const { student_id, otp, new_password } = body;
      if (new_password?.length < 6) {
        return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      }
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account || !account.pending_otp || account.otp_purpose !== 'reset') {
        return NextResponse.json({ error: 'Solicite um novo código.' }, { status: 400 });
      }
      if (account.pending_otp !== otp) {
        return NextResponse.json({ error: 'Código inválido.' }, { status: 400 });
      }
      if (account.otp_expires && new Date().toISOString() > account.otp_expires) {
        return NextResponse.json({ error: 'Código expirado.' }, { status: 400 });
      }

      const salt = generateSalt();
      authMap[student_id] = {
        ...account,
        password_hash: hashPassword(new_password, salt),
        salt,
        pending_otp: undefined,
        otp_expires: undefined,
        otp_purpose: undefined,
        active: true,
      };
      await saveAuthMap(authMap);
      return NextResponse.json({ success: true });
    }

    if (action === 'get-status') {
      const { student_id } = body;
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account) return NextResponse.json({ has_account: false });
      return NextResponse.json({ has_account: true, active: account.active, username: account.username });
    }

    // Admin: create account for existing student (admin-initiated)
    if (action === 'admin-create') {
      // Ações administrativas exigem sessão do painel
      if (!readPanelSession(req)) {
        return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
      }
      const { student_id, username, password, phone } = body;
      const authMap = await loadAuthMap();

      if (authMap[student_id]) {
        return NextResponse.json({ error: 'Aluno já possui conta.' }, { status: 409 });
      }

      const taken = Object.values(authMap).find(a => a.username.toLowerCase() === username.toLowerCase());
      if (taken) return NextResponse.json({ error: 'Usuário já em uso.' }, { status: 409 });

      const salt = generateSalt();
      authMap[student_id] = {
        student_id,
        username,
        password_hash: hashPassword(password, salt),
        salt,
        active: true, // Admin-created accounts are immediately active
        phone,
        created_at: new Date().toISOString(),
      };
      await saveAuthMap(authMap);
      return NextResponse.json({ success: true });
    }

    // Admin: create account with auto-generated username from student name + sequential ID
    if (action === 'admin-create-auto') {
      // Ações administrativas exigem sessão do painel
      if (!readPanelSession(req)) {
        return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
      }
      // Accept student data directly from caller to avoid internal HTTP fetches
      const {
        student_id,
        password,
        phone: phoneArg,
        nucleo_filter,
        email: emailOverride,
        nome_completo: nomeArg,
        nucleo: nucleoArg,
        telefone: telefoneArg,
      } = body;

      if (!student_id) {
        return NextResponse.json({ error: 'student_id é obrigatório.' }, { status: 400 });
      }

      const authMap = await loadAuthMap();

      if (authMap[student_id]) {
        return NextResponse.json({ error: 'Aluno já possui conta.', existing: { username: authMap[student_id].username } }, { status: 409 });
      }

      // Try to get student info from Supabase, fall back to provided data
      let studentName: string = nomeArg || '';
      let studentPhone: string = telefoneArg || phoneArg || '';
      let studentEmail: string = emailOverride || '';
      let studentNucleo: string = nucleoArg || '';

      try {
        const { data: dbStudent } = await supabaseAdmin
          .from('students')
          .select('id, nome_completo, telefone, email, nucleo')
          .eq('id', student_id)
          .maybeSingle();
        if (dbStudent) {
          studentName = dbStudent.nome_completo || studentName;
          studentPhone = phoneArg || dbStudent.telefone || studentPhone;
          studentEmail = emailOverride || dbStudent.email || studentEmail;
          studentNucleo = dbStudent.nucleo || studentNucleo;
        }
      } catch { /* use provided data */ }

      // Require at least a name
      if (!studentName) {
        return NextResponse.json({ error: 'Aluno não encontrado. Forneça nome_completo no corpo da requisição.' }, { status: 404 });
      }

      // Security: if nucleo_filter provided, check student belongs to that nucleo
      if (nucleo_filter && studentNucleo && studentNucleo !== nucleo_filter) {
        return NextResponse.json({ error: 'Aluno não pertence a este núcleo.' }, { status: 403 });
      }

      // Assign sequential display ID directly (no internal HTTP fetch)
      let displayId = `CCLN-${String(Date.now()).slice(-4)}`;
      try {
        const [idMap, counterRaw] = await Promise.all([
          (async () => {
            const { data: u } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl('config/aluno-id-map.json', 30);
            if (!u?.signedUrl) return {} as Record<string, string>;
            const r = await fetch(u.signedUrl, { cache: 'no-store' });
            return r.ok ? (await r.json() as Record<string, string>) : {} as Record<string, string>;
          })(),
          (async () => {
            const { data: u } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl('config/aluno-id-counter.json', 30);
            if (!u?.signedUrl) return { last_id: 0 };
            const r = await fetch(u.signedUrl, { cache: 'no-store' });
            return r.ok ? await r.json() : { last_id: 0 };
          })(),
        ]);

        if (idMap[student_id]) {
          displayId = idMap[student_id];
        } else {
          const nextId = ((counterRaw as { last_id?: number }).last_id || 0) + 1;
          displayId = `CCLN-${String(nextId).padStart(3, '0')}`;
          idMap[student_id] = displayId;
          // Save both map and counter
          await Promise.all([
            supabaseAdmin.storage.from(BUCKET).upload('config/aluno-id-map.json', new Blob([JSON.stringify(idMap, null, 2)], { type: 'application/json' }), { upsert: true }),
            supabaseAdmin.storage.from(BUCKET).upload('config/aluno-id-counter.json', new Blob([JSON.stringify({ last_id: nextId })], { type: 'application/json' }), { upsert: true }),
          ]);
        }
      } catch { /* keep fallback displayId */ }

      // Auto-generate username from first name + display ID number
      function slugify(s: string) {
        return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
      }
      const firstName = studentName.split(' ')[0];
      const idNum = displayId.replace('CCLN-', '');
      let username = `${slugify(firstName)}${idNum}`;
      // Ensure uniqueness
      let suffix = 0;
      while (Object.values(authMap).some(a => a.username.toLowerCase() === username.toLowerCase())) {
        suffix++;
        username = `${slugify(firstName)}${idNum}${suffix}`;
      }

      const salt = generateSalt();
      authMap[student_id] = {
        student_id,
        username,
        email: studentEmail,
        password_hash: hashPassword(password, salt),
        salt,
        active: true,
        phone: studentPhone,
        created_at: new Date().toISOString(),
      };
      await saveAuthMap(authMap);

      // Send welcome message via WhatsApp
      if (studentPhone) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://portal-aluno.vercel.app';
        const welcomeMsg = `Olá, *${studentName.split(' ')[0]}*! 👋\n\nSua conta foi criada com sucesso! Já liberamos seu acesso à área do aluno ✅\n\nAgora você pode entrar na plataforma, registrar sua presença e utilizar todas as funcionalidades disponíveis.\n\n🔗 *${appUrl}/aluno*\n\n👤 Usuário: *${username}*\n🔑 Senha: *${password}*\n\nSeja bem-vindo(a) e bons treinos! 💪🔥\n\n_Portal Aluno_`;
        void sendWhatsAppMessage(studentPhone, welcomeMsg);
      }

      return NextResponse.json({ success: true, username, display_id: displayId, phone: studentPhone, email: studentEmail });
    }

    // Admin: reset password
    if (action === 'admin-reset-password') {
      if (!readPanelSession(req)) {
        return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
      }
      const { student_id, new_password, notify_email, student_name } = body;
      const authMap = await loadAuthMap();
      if (!authMap[student_id]) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

      const salt = generateSalt();
      authMap[student_id] = {
        ...authMap[student_id],
        password_hash: hashPassword(new_password, salt),
        salt,
      };
      await saveAuthMap(authMap);

      // Avisa o aluno por e-mail (quando informado e houver serviço configurado)
      let email_sent = false;
      let email_skipped = false;
      const destino = String(notify_email || '').trim();
      if (destino.includes('@')) {
        const { buildNewPasswordHtml } = await import('@/lib/email');
        const tmpl = buildNewPasswordHtml(String(student_name || 'Aluno'), String(new_password), `${process.env.NEXT_PUBLIC_APP_URL || ''}/aluno`);
        const result = await sendEmail(destino, tmpl.subject, tmpl.html);
        email_sent = !!result.sent;
        email_skipped = !!result.skipped;
      }

      return NextResponse.json({ success: true, email_sent, email_skipped });
    }

    // ── Update profile (email, username) — requires session token (student_id)
    if (action === 'update-profile') {
      const { student_id, new_email, new_username, current_password } = body;
      // Somente o próprio aluno logado pode alterar a própria conta
      const sessPropria = readAlunoSessionFromReq(req);
      if (!sessPropria || sessPropria.sid !== student_id) {
        return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      }
      if (!student_id) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

      // Verify current password
      if (!current_password || hashPassword(current_password, account.salt) !== account.password_hash) {
        return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 403 });
      }

      // Check username uniqueness if changing
      if (new_username && new_username !== account.username) {
        const taken = Object.values(authMap).find(
          a => a.student_id !== student_id && a.username.toLowerCase() === new_username.toLowerCase()
        );
        if (taken) return NextResponse.json({ error: 'Usuário já em uso.' }, { status: 409 });
        account.username = new_username;
      }

      // Update email
      if (new_email !== undefined) {
        account.email = new_email || '';
        // Also save to Supabase students table
        try {
          await supabaseAdmin.from('students').update({ email: new_email || null }).eq('id', student_id);
        } catch { /* column may not exist yet */ }
      }

      authMap[student_id] = account;
      await saveAuthMap(authMap);
      return NextResponse.json({ success: true, username: account.username, email: account.email });
    }

    // ── Change password — requires current password verification
    if (action === 'change-password') {
      const { student_id, current_password, new_password } = body;
      const sessPropria = readAlunoSessionFromReq(req);
      if (!sessPropria || sessPropria.sid !== student_id) {
        return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      }
      if (!student_id) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

      if (!current_password || hashPassword(current_password, account.salt) !== account.password_hash) {
        return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 403 });
      }
      if (!new_password || new_password.length < 6) {
        return NextResponse.json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      }

      const salt = generateSalt();
      authMap[student_id] = {
        ...account,
        password_hash: hashPassword(new_password, salt),
        salt,
      };
      await saveAuthMap(authMap);
      return NextResponse.json({ success: true });
    }

    // ── Delete account — removes login credentials (student record kept for history)
    if (action === 'delete-account') {
      const { student_id, current_password } = body;
      const sessPropria = readAlunoSessionFromReq(req);
      if (!sessPropria || sessPropria.sid !== student_id) {
        return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      }
      if (!student_id) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

      if (!current_password || hashPassword(current_password, account.salt) !== account.password_hash) {
        return NextResponse.json({ error: 'Senha incorreta. Não é possível excluir.' }, { status: 403 });
      }

      delete authMap[student_id];
      await saveAuthMap(authMap);
      return NextResponse.json({ success: true });
    }

    // ── Admin: edit account (username, email, phone) — no password required
    if (action === 'admin-edit-account') {
      if (!readPanelSession(req)) {
        return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
      }
      const { student_id, new_username, new_email, new_phone } = body;
      if (!student_id) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

      // Check username uniqueness if changing
      if (new_username && new_username.trim() !== account.username) {
        const taken = Object.values(authMap).find(
          a => a.student_id !== student_id && a.username.toLowerCase() === new_username.trim().toLowerCase()
        );
        if (taken) return NextResponse.json({ error: 'Nome de usuário já está em uso por outra conta.' }, { status: 409 });
        account.username = new_username.trim();
      }

      if (new_email !== undefined) {
        account.email = new_email || '';
        try { await supabaseAdmin.from('students').update({ email: new_email || null }).eq('id', student_id); } catch { /* column may not exist */ }
      }

      let otpSentToNewPhone = false;
      if (new_phone !== undefined) {
        const oldPhone = account.phone || '';
        const newPhoneDigits = (new_phone || '').replace(/\D/g, '');
        const newPhoneNorm = newPhoneDigits ? (newPhoneDigits.startsWith('55') ? newPhoneDigits : `55${newPhoneDigits}`) : '';
        const phoneChanged = newPhoneNorm !== oldPhone.replace(/\D/g, '');

        account.phone = newPhoneNorm;

        // When phone changes: always update students table and generate new OTP
        if (phoneChanged && newPhoneNorm) {
          // Also update students table phone
          try { await supabaseAdmin.from('students').update({ telefone: new_phone }).eq('id', student_id); } catch { /* silent */ }

          if (!account.active) {
            // Inactive account: generate new OTP for new number
            const newOtp = generateOTP();
            account.pending_otp = newOtp;
            account.otp_expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            const { data: st } = await supabaseAdmin.from('students').select('nome_completo').eq('id', student_id).maybeSingle();
            otpSentToNewPhone = await sendWhatsAppOTP(newPhoneNorm, newOtp, st?.nome_completo || 'Aluno');
          }
          // Active account: just update phone — no re-validation needed (account already active)
        }
      }

      authMap[student_id] = account;
      await saveAuthMap(authMap);
      return NextResponse.json({ success: true, username: account.username, email: account.email, phone: account.phone, otp_resent: otpSentToNewPhone });
    }

    // ── Admin: reset phone validation — deactivates account so student can re-register with corrected phone
    if (action === 'admin-reset-phone-validation') {
      if (!readPanelSession(req)) {
        return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
      }
      const { student_id } = body;
      if (!student_id) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
      const authMap = await loadAuthMap();
      const account = authMap[student_id];
      if (!account) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });

      // Fetch latest phone from students table
      const { data: st } = await supabaseAdmin.from('students').select('nome_completo, telefone').eq('id', student_id).maybeSingle();
      const latestPhoneRaw = ((st?.telefone || account.phone || '').replace(/\D/g, ''));
      const latestPhone = latestPhoneRaw ? (latestPhoneRaw.startsWith('55') ? latestPhoneRaw : `55${latestPhoneRaw}`) : '';

      const newOtp = generateOTP();
      authMap[student_id] = {
        ...account,
        active: false,
        phone: latestPhone || account.phone,
        pending_otp: newOtp,
        otp_expires: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      };
      await saveAuthMap(authMap);

      let sent = false;
      if (latestPhone) {
        sent = await sendWhatsAppOTP(latestPhone, newOtp, st?.nome_completo || 'Aluno');
      }

      return NextResponse.json({
        success: true,
        phone: latestPhone ? `****${latestPhone.slice(-4)}` : null,
        otp_sent: sent,
        message: 'Validação resetada. Novo código enviado para o telefone atualizado.',
      });
    }

    // ── Admin: delete account — no password required (admin privilege)
    if (action === 'admin-delete-account') {
      if (!readPanelSession(req)) {
        return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
      }
      const { student_id } = body;
      if (!student_id) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
      const authMap = await loadAuthMap();
      if (!authMap[student_id]) return NextResponse.json({ error: 'Conta não encontrada.' }, { status: 404 });
      delete authMap[student_id];
      await saveAuthMap(authMap);
      return NextResponse.json({ success: true });
    }

    // ── STATUS DA CONTA (faixa de idade, autorização, perfis, tutelados) ─────
    if (action === 'account-status') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

      const { data: st } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, data_nascimento, foto_url, nucleo, graduacao, menor_de_idade, assinatura_responsavel')
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

      const { obterPerfilResponsavel, tutoradosDoResponsavel, vinculosPendentesDoAluno } = await import('@/lib/guardians');
      const tuts = perfilResp ? await tutoradosDoResponsavel(sess.sid) : [];
      const pendentes = await vinculosPendentesDoAluno(sess.sid);

      return NextResponse.json({
        student_id: sess.sid,
        idade,
        faixa,
        eh_adulto: ehAdulto,
        maior_de_idade: ehAdulto,
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

      const { consumirCodigoVinculo, criarVinculo, criarPerfilResponsavel } = await import('@/lib/guardians');
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
      if (nucleo) {
        const { data: tenant } = await supabaseAdmin.from('tenants').select('nome').eq('id', nucleo).maybeSingle();
        if (!tenant) return NextResponse.json({ error: 'Núcleo não encontrado.' }, { status: 400 });
        tenantNome = tenant.nome || '';
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
      });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('aluno/auth error:', msg);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

async function sendEmailOTP(email: string, otp: string, name: string): Promise<EmailResult> {
  try {
    const { subject, html } = buildOtpHtml(name, otp);
    return await sendEmail(email, subject, html);
  } catch {
    return { sent: false, error: 'exceção no envio' };
  }
}

async function sendWhatsAppMessage(phone: string, message: string): Promise<void> {
  const digits = phone.replace(/\D/g, '');
  const fullPhone = digits.startsWith('55') ? digits : `55${digits}`;
  const zapiInstance = process.env.ZAPI_INSTANCE_ID;
  const zapiToken = process.env.ZAPI_TOKEN;
  const zapiClientToken = process.env.ZAPI_CLIENT_TOKEN;
  if (zapiInstance && zapiToken) {
    try {
      await fetch(`https://api.z-api.io/instances/${zapiInstance}/token/${zapiToken}/send-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(zapiClientToken ? { 'Client-Token': zapiClientToken } : {}) },
        body: JSON.stringify({ phone: fullPhone, message }),
      });
      return;
    } catch { /* fallthrough */ }
  }
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM;
  if (twilioSid && twilioToken && twilioFrom) {
    try {
      const params = new URLSearchParams({ From: `whatsapp:${twilioFrom}`, To: `whatsapp:+${fullPhone}`, Body: message });
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
    } catch { /* silent fail */ }
  }
}

async function sendWhatsAppOTP(phone: string, otp: string, name: string, isReset = false): Promise<boolean> {
  // Clean phone number
  const digits = phone.replace(/\D/g, '');
  const fullPhone = digits.startsWith('55') ? digits : `55${digits}`;

  const message = isReset
    ? `Olá ${name}! Seu código de recuperação de senha é: *${otp}*. Válido por 15 minutos. Se não foi você, ignore esta mensagem.`
    : `Olá ${name}! Bem-vindo(a) à CCLN! Seu código de ativação é: *${otp}*. Válido por 10 minutos. Digite este código para ativar sua conta.`;

  // Try Z-API first
  const zapiInstance = process.env.ZAPI_INSTANCE_ID;
  const zapiToken = process.env.ZAPI_TOKEN;
  const zapiClientToken = process.env.ZAPI_CLIENT_TOKEN;

  if (zapiInstance && zapiToken) {
    try {
      await fetch(`https://api.z-api.io/instances/${zapiInstance}/token/${zapiToken}/send-text`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(zapiClientToken ? { 'Client-Token': zapiClientToken } : {}),
        },
        body: JSON.stringify({ phone: fullPhone, message }),
      });
      return true;
    } catch { /* fallthrough */ }
  }

  // Fallback: Twilio WhatsApp
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_FROM;

  if (twilioSid && twilioToken && twilioFrom) {
    try {
      const params = new URLSearchParams({
        From: `whatsapp:${twilioFrom}`,
        To: `whatsapp:+${fullPhone}`,
        Body: message,
      });
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });
      return true;
    } catch { /* silent fail */ }
  }

  // No credentials configured — nothing was sent
  return false;
}
