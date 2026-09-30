import crypto from 'crypto';

/**
 * Sessão do painel administrativo em cookie assinado (HMAC-SHA256).
 * - HttpOnly: o JavaScript do navegador não lê o token.
 * - SameSite=Lax + Secure em produção.
 * - Curta duração (12h): painel administrativo pede novo login no dia seguinte.
 */

export const PANEL_COOKIE = 'pa_admin';

export type PanelRole = 'owner' | 'admin_geral' | 'admin_nucleo';

export type PanelSession = {
  u: string;      // login (key) da conta
  n: string;      // núcleo principal: slug ou 'geral'
  r: PanelRole;
  ns?: string[];  // slugs adicionais gerenciados (admin de núcleo com múltiplos núcleos)
  iat: number;
  exp: number;
  v: 1;
};

const SESSION_TTL_HOURS = 12;

function panelSecret(): string {
  return (
    process.env.PA_SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    'portal-aluno-dev-secret'
  );
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', panelSecret()).update(payload).digest('base64url');
}

export function createPanelSession(username: string, nucleo: string, role: PanelRole, nucleos?: string[]): PanelSession {
  const now = Date.now();
  const extra = Array.isArray(nucleos) && nucleos.length > 0 ? nucleos.slice() : undefined;
  return { u: username, n: nucleo, r: role, ns: extra, iat: now, exp: now + SESSION_TTL_HOURS * 60 * 60 * 1000, v: 1 };
}

export function serializePanelSession(session: PanelSession): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyPanelSession(token: string | undefined | null): PanelSession | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PanelSession;
    if (session.v !== 1 || !session.u || !session.exp) return null;
    if (session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function panelCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_HOURS * 60 * 60,
  };
}

/** Lê e valida a sessão do painel a partir de um NextRequest/Request. */
export function readPanelSession(req: Request): PanelSession | null {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${PANEL_COOKIE}=([^;]+)`));
  if (!match) return null;
  return verifyPanelSession(decodeURIComponent(match[1]));
}
