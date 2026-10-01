import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import {
  SESSION_COOKIE,
  createAlunoSession,
  serializeAlunoSession,
  sessionCookieOptions,
  readAlunoSessionFromReq,
} from '@/lib/alunoSession';
import { serializeProfile, readProfileFromCookieValue, profileCookieOptions, PROFILE_COOKIE } from '@/lib/ator';
import { idadeEm, faixaCadastro, mensagemFaixa } from '@/lib/idade';
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
const ID_MAP_KEY = 'config/aluno-id-map.json';

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

/* ── GET: contas (painel) ─────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  try {
    const authMap = await loadAuthMap();
    const idMap = await loadFromStorage(ID_MAP_KEY);

    // ?sessao=1 → resumo da conta logada + perfis acessíveis (Quem está usando?)
    if (req.nextUrl.searchParams.get('sessao') === '1') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ authenticated: false }, { status: 401 });

      const acc = authMap[sess.sid];
      const { data: st } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, foto_url, nucleo, graduacao, data_nascimento, menor_de_idade, assinatura_responsavel')
        .eq('id', sess.sid)
        .maybeSingle();
      if (!st) return NextResponse.json({ authenticated: false }, { status: 401 });

      const idade = idadeEm(st.data_nascimento || '');
      const { data: authz } = await supabaseAdmin
        .from('adolescent_authorizations')
        .select('status')
        .eq('student_id', sess.sid)
        .maybeSingle();
      const faixa = idade >= 0 ? faixaCadastro(idade) : 'independente';
      const autorizacaoStatus = faixa === 'precisa_autorizacao'
        ? (authz?.status === 'authorized' ? 'autorizado' : authz?.status === 'revoked' ? 'revogado' : 'necessaria_pendente')
        : 'desnecessaria';

      // Perfis acessíveis: o próprio + tutelados com vínculo ACTIVE
      const { tutoradosDoResponsavel } = await import('@/lib/guardians');
      const tuts = await tutoradosDoResponsavel(sess.sid);
      const ctx = readProfileFromCookieValue(req.cookies.get(PROFILE_COOKIE)?.value);
      const perfilAtivo = ctx?.sid || sess.sid;

      return NextResponse.json({
        authenticated: true,
        conta: {
          student_id: sess.sid,
          username: acc?.username || sess.un,
          nome_completo: st.nome_completo,
          foto_url: st.foto_url || null,
          nucleo: st.nucleo || null,
          graduacao: st.graduacao || null,
          idade,
          faixa,
          maior_de_idade: idade >= 18 || idade < 0,
          autorizacao_status: autorizacaoStatus,
          mensagem_faixa: idade >= 0 ? mensagemFaixa(faixa) : '',
        },
        perfil_ativo: perfilAtivo,
        perfis: [
          {
            student_id: st.id,
            nome_completo: st.nome_completo,
            foto_url: st.foto_url || null,
            nucleo: st.nucleo || null,
            tipo: 'proprio' as const,
          },
          ...tuts
            .filter(t => t.status_vinculo === 'active')
            .map(t => ({
              student_id: t.student_id,
              nome_completo: t.nome_completo,
              foto_url: t.foto_url,
              nucleo: t.nucleo,
              tipo: 'tutelado' as const,
            })),
        ],
      });
    }

    // Painel: lista de contas (sem dados sensíveis). A rota é do painel —
    // aluno comum não lista contas; o resumo da própria conta usa ?sessao=1.
    if (!readPanelSession(req)) {
      return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
    }
    const safe = Object.values(authMap).map((acc: AlunoAccount) => ({
      student_id: acc.student_id,
      username: acc.username,
      email: acc.email,
      active: acc.active,
      phone: acc.phone,
      created_at: acc.created_at,
      last_login: acc.last_login,
      display_id: (idMap as Record<string, string>)[acc.student_id] || null,
    }));
    return NextResponse.json(safe);
  } catch {
    return NextResponse.json([]);
  }
}

/* ── POST: login único, registro, troca de perfil ─────────────────────────── */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || '');

    /* ── LOGIN (com gate de idade e autorização de menor) ─────────────────── */
    if (action === 'login') {
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!username || !password) {
        return NextResponse.json({ error: 'Usuário e senha obrigatórios.' }, { status: 400 });
      }
      const authMap = await loadAuthMap();
      const entryKey = Object.keys(authMap).find(k => {
        const a = authMap[k];
        return a?.username?.toLowerCase() === username || a?.email?.toLowerCase() === username;
      });
      const account = entryKey ? authMap[entryKey] : null;
      if (!account || hashPassword(password, account.salt) !== account.password_hash) {
        return NextResponse.json({ error: 'Usuário ou senha incorretos.' }, { status: 401 });
      }
      if (!account.active) {
        return NextResponse.json({ error: 'Conta pendente de ativação.', pending: true }, { status: 403 });
      }

      const { data: st } = await supabaseAdmin
        .from('students')
        .select('id, nome_completo, foto_url, nucleo, graduacao, data_nascimento, menor_de_idade, assinatura_responsavel')
        .eq('id', account.student_id)
        .maybeSingle();
      if (!st) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });

      // Regras de idade: a idade vem SEMPRE da data armazenada
      const idade = idadeEm(st.data_nascimento || '');
      const faixa = idade >= 0 ? faixaCadastro(idade) : 'independente';
      if (faixa === 'bloqueado') {
        return NextResponse.json({
          error: 'Contas individuais são a partir de 15 anos. Menores de 15 devem ser cadastrados pelo responsável.',
          codigo: 'menor_de_15',
        }, { status: 422 });
      }
      if (faixa === 'precisa_autorizacao') {
        const { data: authz } = await supabaseAdmin
          .from('adolescent_authorizations')
          .select('status')
          .eq('student_id', account.student_id)
          .maybeSingle();
        if (authz?.status === 'revoked') {
          return NextResponse.json({
            error: 'A autorização do seu responsável foi revogada. Fale com o admin do seu núcleo.',
            codigo: 'autorizacao_revogada',
          }, { status: 403 });
        }
        // Pendente: entra normalmente — é dentro do app que a autorização é
        // concluída (dados do responsável → código → termo). Ações ficam
        // bloqueadas até a assinatura (gate de conformidade cadastral).
      }

      authMap[entryKey!] = { ...account, last_login: new Date().toISOString() };
      await saveAuthMap(authMap);

      const store = await cookies();
      store.set(SESSION_COOKIE, serializeAlunoSession(createAlunoSession(account.student_id, account.username)), sessionCookieOptions());
      // Limpa contexto de perfil de sessões anteriores
      store.set(PROFILE_COOKIE, '', { ...profileCookieOptions(), maxAge: 0 });

      return NextResponse.json({
        success: true,
        student_id: account.student_id,
        username: account.username,
        student: st,
      });
    }

    /* ── REGISTER: cria conta + cadastro do zero (com data de nascimento) ─── */
    if (action === 'register') {
      const nomeTrim = String(body.nome_completo || '').trim().replace(/\s+/g, ' ');
      const emailNorm = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const dataNasc = String(body.data_nascimento || '').slice(0, 10);
      const cpfIn = String(body.cpf || '').trim();
      const phoneIn = String(body.telefone || body.phone || '').trim();

      if (nomeTrim.split(' ').filter(Boolean).length < 2) {
        return NextResponse.json({ error: 'Informe seu nome completo (nome e sobrenome).' }, { status: 400 });
      }
      if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
        return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
      }
      if (password.length < 6) {
        return NextResponse.json({ error: 'Senha deve ter pelo menos 6 caracteres.' }, { status: 400 });
      }
      if (!dataNasc || isNaN(new Date(`${dataNasc}T12:00:00`).getTime()) || dataNasc > new Date().toISOString().slice(0, 10)) {
        return NextResponse.json({ error: 'Informe uma data de nascimento válida.' }, { status: 400 });
      }

      const idade = idadeEm(dataNasc);
      const faixa = faixaCadastro(idade);
      if (faixa === 'bloqueado') {
        return NextResponse.json({ error: mensagemFaixa('bloqueado'), codigo: 'menor_de_15' }, { status: 422 });
      }
      const { isValidCPF, cpfDigits } = await import('@/lib/studentCompliance');
      if (cpfIn && !isValidCPF(cpfDigits(cpfIn))) {
        return NextResponse.json({ error: 'CPF inválido — verifique os dígitos.' }, { status: 422 });
      }

      const authMap = await loadAuthMap();
      if (Object.values(authMap).some(a => a.email?.toLowerCase() === emailNorm)) {
        return NextResponse.json({ error: 'Este e-mail já está vinculado a outra conta.' }, { status: 409 });
      }
      if (cpfIn) {
        const { data: cpfOutro } = await supabaseAdmin
          .from('students').select('id').eq('cpf', cpfIn).neq('cpf', '').maybeSingle();
        if (cpfOutro && authMap[cpfOutro.id]) {
          return NextResponse.json({ error: 'Este CPF já possui conta. Use a recuperação de senha.' }, { status: 409 });
        }
      }

      // Cria o perfil de aluno (linha students) — a conta nasce em seguida
      const base: Record<string, unknown> = {
        nome_completo: nomeTrim,
        email: emailNorm,
        data_nascimento: dataNasc,
        menor_de_idade: idade < 18,
      };
      if (cpfIn) base.cpf = cpfIn;
      if (phoneIn) base.telefone = phoneIn;
      const placeholders: Record<string, unknown> = {
        cpf: cpfIn || '', identidade: '', data_nascimento: dataNasc,
        telefone: phoneIn || '', cep: '', endereco: '', numero: '', complemento: '',
        bairro: '', cidade: '', estado: '', graduacao: 'Cru', tipo_graduacao: 'corda',
        nucleo: '', nome_pai: '', nome_mae: '', nome_responsavel: '', cpf_responsavel: '',
        apelido: '', nome_social: '', sexo: '',
      };
      let target: { id: string; nome_completo: string } | null = null;
      let payload: Record<string, unknown> = { ...base };
      for (let attempt = 0; attempt < 2; attempt++) {
        const { data, error } = await supabaseAdmin
          .from('students').insert(payload)
          .select('id, nome_completo')
          .single();
        if (!error && data) { target = data as { id: string; nome_completo: string }; break; }
        if (error && /null value|not-null|NOT NULL/i.test(error.message || '')) {
          payload = { ...placeholders, ...base };
          continue;
        }
        return NextResponse.json({ error: error?.message || 'Erro ao criar seu cadastro.' }, { status: 500 });
      }
      if (!target) return NextResponse.json({ error: 'Erro ao criar seu cadastro. Tente novamente.' }, { status: 500 });

      const salt = crypto.randomBytes(16).toString('hex');
      authMap[target.id] = {
        student_id: target.id,
        username: emailNorm,
        email: emailNorm,
        password_hash: hashPassword(password, salt),
        salt,
        active: true,
        phone: phoneIn ? (phoneIn.replace(/\D/g, '').startsWith('55') ? phoneIn.replace(/\D/g, '') : `55${phoneIn.replace(/\D/g, '')}`) : '',
        created_at: new Date().toISOString(),
      };
      await saveAuthMap(authMap);

      const store = await cookies();
      store.set(SESSION_COOKIE, serializeAlunoSession(createAlunoSession(target.id, emailNorm)), sessionCookieOptions());

      return NextResponse.json({
        success: true,
        logged_in: true,
        student_id: target.id,
        student_name: nomeTrim.split(' ')[0],
        idade,
        faixa,
        mensagem_faixa: mensagemFaixa(faixa),
      });    }

    /* ── TROCAR PERFIL ("Quem está usando?") ──────────────────────────────── */
    if (action === 'switch-profile') {
      const sess = readAlunoSessionFromReq(req);
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      const targetId = String(body.student_id || '');
      if (!targetId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });

      if (targetId === sess.sid) {
        const store = await cookies();
        store.set(PROFILE_COOKIE, '', { ...profileCookieOptions(), maxAge: 0 });
        return NextResponse.json({ success: true, perfil_ativo: sess.sid, tipo: 'proprio' });
      }
      const { podeAgirComo } = await import('@/lib/guardians');
      const pode = await podeAgirComo(sess.sid, targetId);
      if (!pode) {
        return NextResponse.json({ error: 'Você não tem acesso a este perfil.' }, { status: 403 });
      }
      const { data: st } = await supabaseAdmin
        .from('students').select('nome_completo').eq('id', targetId).maybeSingle();
      const store = await cookies();
      store.set(PROFILE_COOKIE, serializeProfile({ sid: targetId, iat: Date.now() }), profileCookieOptions());
      await appendAudit({
        actor: sess.sid, actor_type: 'student', action: 'perfil_trocado',
        target_id: targetId, target_name: st?.nome_completo,
      });
      return NextResponse.json({ success: true, perfil_ativo: targetId, tipo: 'tutelado' });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (err) {
    console.error('aluno/contas POST error:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

/* ── PUT: sincroniza e-mail da conta (fluxo já existente de Meus Dados) ──── */

export async function PUT(req: Request) {
  try {
    const { student_id, email } = await req.json();
    if (!student_id || typeof email !== 'string') {
      return NextResponse.json({ error: 'student_id e email são obrigatórios.' }, { status: 400 });
    }
    // Somente o próprio aluno logado, admin do painel, ou responsável com vínculo
    const sess = readAlunoSessionFromReq(req);
    const painel = readPanelSession(req);
    if (!painel) {
      if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
      if (sess.sid !== student_id) {
        const { podeAgirComo } = await import('@/lib/guardians');
        if (!(await podeAgirComo(sess.sid, student_id))) {
          return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 });
        }
      }
    }
    const clean = email.trim().toLowerCase();
    if (clean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }

    const authMap = (await loadFromStorage(AUTH_KEY)) as Record<string, Record<string, unknown>>;
    const entryKey = Object.keys(authMap).find(k => (authMap[k] as { student_id?: string })?.student_id === student_id);
    const entry = entryKey ? authMap[entryKey] : null;

    if (clean && entry && entryKey) {
      authMap[entryKey] = { ...entry, email: clean };
      await saveAuthMap(authMap);
    }
    return NextResponse.json({ ok: true, synced: !!clean && !!entryKey });
  } catch {
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
