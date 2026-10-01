import { NextRequest, NextResponse } from 'next/server';
import { isValidBackupFilename, getBackupDownloadUrl } from '@/lib/backupSistema';
import { requireGeralAdmin } from '@/lib/adminGuard';

/** Gera link temporário (2 min) para baixar uma cópia — só Owner/Admin Geral. */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  try {
    const filename = req.nextUrl.searchParams.get('filename') || '';
    if (!isValidBackupFilename(filename)) {
      return NextResponse.json({ ok: false, error: 'Arquivo inválido.' }, { status: 400 });
    }
    const url = await getBackupDownloadUrl(filename);
    return NextResponse.json({ ok: true, url });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 400 });
  }
}
