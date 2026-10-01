import crypto from 'crypto';

/**
 * Sessão do aluno em cookie assinado (HMAC-SHA256).
 * - HttpOnly: o JavaScript do navegador não lê o token.
 * - SameSite=Lax + Secure em produção.
 * - Sem segredo configurado, deriva um do SUPABASE_SERVICE_ROLE_KEY no servidor
 *   (nunca exposto ao cliente).
 */

export const SESSION_COOKIE = 'pa_session';

export type AlunoSession = {
  sid: string;   // student_id (uuid)
  un: string;    // username
  iat: number;   // emitida em (ms)
  exp: number;   // expira em (ms)
  v: 1;
};

const SESSION_TTL_DAYS = 30;

function sessionSecret(): string {
  return (
    process.env.PA_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'portal-aluno-dev-secret'
  );
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', sessionSecret()).update(payload).digest('base64url');
}

export function createAlunoSession(studentId: string, username: string): AlunoSession {
  const now = Date.now();
  return {
    sid: studentId,
    un: username,
    iat: now,
    exp: now + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    v: 1,
  };
}

export function serializeAlunoSession(session: AlunoSession): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyAlunoSession(token: string | undefined | null): AlunoSession | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AlunoSession;
    if (session.v !== 1 || !session.sid || !session.exp) return null;
    if (session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

/** Lê a sessão do aluno a partir de um Request (route handlers). */
export function readAlunoSessionFromReq(req: Request): AlunoSession | null {
  const token = req.headers.get('cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  return verifyAlunoSession(token);
}
