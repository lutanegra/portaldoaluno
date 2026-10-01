import { NextRequest, NextResponse } from 'next/server';
import { getBackupInfo, runBackupAlunos, restoreFromLatestBackup, type ImportResult } from '@/lib/backupAlunos';
import { requireGeralAdmin } from '@/lib/adminGuard';

export const dynamic = 'force-dynamic';

// GET  /api/admin/backup-alunos        → status + histórico (Owner/Admin Geral)
// POST /api/admin/backup-alunos        → gera backup agora (Owner/Admin Geral)
// PUT  /api/admin/backup-alunos        → restaura do backup mais recente (Owner/Admin Geral)
export async function GET(req: NextRequest) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  const info = await getBackupInfo();
  return NextResponse.json({ ok: true, ...info });
}

export async function POST(req: Request) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  const r = await runBackupAlunos(__g.session.u);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, item: r.item });
}

export async function PUT(req: Request) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  try {
    const result: ImportResult = await restoreFromLatestBackup();
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message || err) }, { status: 400 });
  }
}
