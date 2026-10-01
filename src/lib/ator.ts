import crypto from 'crypto';
import {
  SESSION_COOKIE,
  verifyAlunoSession,
  type AlunoSession,
} from './alunoSession';

/**
 * CONTEXTO DE PERFIL (responsável ↔ tutelado)
 *
 * A sessão cookie continua sendo a IDENTIDADE (conta do aluno adulto). O
 * contexto de perfil é um cookie SEPARADO, assinado, sem valor de segurança
 * própria: toda mutação/leitura passa por podeAgirComo() no servidor, que
 * valida vínculo ACTIVE em guardian_links. O cookie só diz "qual perfil está
 * aberto na tela" — nunca autoriza nada sozinho.
 */

export const PROFILE_COOKIE = 'pa_profile';

export type ProfileContext = { sid: string; iat: number };

function profileSecret(): string {
  return process.env.PA_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'portal-aluno-dev-secret';
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', profileSecret()).update(payload).digest('base64url');
}

export function serializeProfile(ctx: ProfileContext): string {
  const payload = Buffer.from(JSON.stringify(ctx), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyProfile(value: string | undefined | null): ProfileContext | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const ctx = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ProfileContext;
    if (!ctx?.sid || typeof ctx.iat !== 'number') return null;
    // Contexto de perfil não sobrevive à sessão: 12h no máximo
    if (Date.now() - ctx.iat > 12 * 60 * 60 * 1000) return null;
    return ctx;
  } catch {
    return null;
  }
}

/** Lê a sessão de identidade a partir de um Request (rotas route handler). */
export function readAlunoSession(req: Request): AlunoSession | null {
  const token = req.headers.get('cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  return verifyAlunoSession(token);
}

/** Lê o contexto de perfil a partir de um Request. */
export function readProfileContext(req: Request): ProfileContext | null {
  const token = req.headers.get('cookie')?.match(new RegExp(`${PROFILE_COOKIE}=([^;]+)`))?.[1];
  return verifyProfile(token);
}

/** Lê o contexto de perfil a partir de um valor de cookie já extraído. */
export function readProfileFromCookieValue(value: string | undefined): ProfileContext | null {
  return verifyProfile(value);
}

export type Ator = { studentId: string; viaPainel: boolean; loginPainel?: string; emNomeDe?: 'proprio' | 'responsavel' };

/**
 * Resolve QUEM está agindo: painel (qualquer student_id informado) ou aluno
 * autenticado (a si mesmo, a um tutelado com vínculo ACTIVE, ou ao perfil
 * aberto no contexto "Quem está usando?"). Retorna o student_id seguro e a
 * natureza da ação.
 */
export async function resolverAtor(
  req: Request,
  targetStudentId?: string | null,
): Promise<Ator | null> {
  const { readPanelSession } = await import('./panelSession');
  const sess = readPanelSession(req);
  if (sess) {
    return { studentId: targetStudentId || '', viaPainel: true, loginPainel: sess.u, emNomeDe: 'responsavel' };
  }
  const aluno = readAlunoSession(req);
  if (!aluno) return null;

  // Sem alvo explícito: usa o contexto de perfil aberto (tutelado) quando houver
  let alvo = targetStudentId || '';
  if (!alvo) {
    const ctx = readProfileContext(req);
    if (ctx && ctx.sid !== aluno.sid) {
      const { podeAgirComo } = await import('./guardians');
      if (await podeAgirComo(aluno.sid, ctx.sid)) {
        return { studentId: ctx.sid, viaPainel: false, emNomeDe: 'responsavel' };
      }
    }
    return { studentId: aluno.sid, viaPainel: false, emNomeDe: 'proprio' };
  }

  if (alvo === aluno.sid) {
    return { studentId: aluno.sid, viaPainel: false, emNomeDe: 'proprio' };
  }
  const { podeAgirComo } = await import('./guardians');
  const pode = await podeAgirComo(aluno.sid, alvo);
  if (!pode) return null;
  return { studentId: alvo, viaPainel: false, emNomeDe: 'responsavel' };
}

/** Cookie de perfil (mesmas opções do cookie de sessão). */
export function profileCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  };
}
