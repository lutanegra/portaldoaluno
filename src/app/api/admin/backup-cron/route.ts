import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { runDueBackupIfNeeded } from '@/lib/backupSistema';
import { readPanelSession } from '@/lib/panelSession';

/**
 * Gatilho de backup automático (executa NO SERVIDOR).
 * - Cron externo (Vercel Cron, GitHub Actions, EasyCron…): GET com o header
 *   `Authorization: Bearer <BACKUP_CRON_SECRET>` (variável de ambiente).
 * - Sem segredo configurado, a verificação também roda no login do painel e
 *   na leitura da configuração do sistema (rede de segurança).
 * - POST com sessão do painel (Owner/Admin Geral) força a verificação.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.BACKUP_CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') || '';
  const bearer = header.replace(/^Bearer\s+/i, '').trim();
  const alt = (req.headers.get('x-cron-key') || '').trim();
  const candidato = bearer || alt;
  if (!candidato) return false;
  const a = Buffer.from(candidato);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req) && !readPanelSession(req)) {
    return NextResponse.json({ ok: false, error: 'Não autorizado.' }, { status: 401 });
  }
  const resultado = await runDueBackupIfNeeded(false);
  return NextResponse.json({ ok: true, ...resultado, verificado_em: new Date().toISOString() });
}

export async function POST(req: NextRequest) {
  const forcar = cronAuthorized(req) || !!readPanelSession(req);
  if (!forcar) {
    return NextResponse.json({ ok: false, error: 'Não autorizado.' }, { status: 401 });
  }
  const resultado = await runDueBackupIfNeeded(true);
  return NextResponse.json({ ok: true, ...resultado, verificado_em: new Date().toISOString() });
}
