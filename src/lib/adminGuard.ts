/**
 * Guarda de acesso para rotas administrativas.
 * Toda rota sob /api/admin deve chamar requirePanelAdmin(req) antes de qualquer
 * leitura/escrita. A permissão vem SEMPRE do cookie de sessão assinado
 * (pa_admin) — nunca de header enviável pelo cliente.
 */
import { NextResponse } from 'next/server';
import { readPanelSession, type PanelSession } from '@/lib/panelSession';

export type AdminGuard =
  | { ok: true; session: PanelSession }
  | { ok: false; res: NextResponse };

export function requirePanelAdmin(req: Request): AdminGuard {
  const session = readPanelSession(req);
  if (!session) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Sessão administrativa necessária. Faça login novamente.' },
        { status: 401 },
      ),
    };
  }
  return { ok: true, session };
}

/** Exige que a sessão seja de gestão (owner ou admin geral). */
export function requireGeralAdmin(req: Request): AdminGuard {
  const guard = requirePanelAdmin(req);
  if (!guard.ok) return guard;
  if (guard.session.n !== 'geral') {
    return {
      ok: false,
      res: NextResponse.json(
        { error: 'Acesso restrito ao Owner/Admin Geral.' },
        { status: 403 },
      ),
    };
  }
  return guard;
}
