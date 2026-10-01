import { NextRequest, NextResponse } from 'next/server';
import { applyStudentRows } from '@/lib/backupAlunos';
import { requirePanelAdmin } from '@/lib/adminGuard';

export const dynamic = 'force-dynamic';

// POST /api/admin/import-alunos
// Body: { rows: Array<Record<string,string>> }
// A permissão vem SEMPRE da sessão do painel (cookie pa_admin); o campo
// auth=... do corpo foi aposentado por segurança.
// Correlaciona por CPF primeiro, depois nome_completo normalizado, e aplica
// PATCH apenas nos campos preenchidos do CSV.
export async function POST(req: NextRequest) {
  const __g = requirePanelAdmin(req);
  if (!__g.ok) return __g.res;

  try {
    const body = await req.json();
    const rows: Record<string, string>[] = body.rows || [];
    if (!rows.length) return NextResponse.json({ error: 'Nenhum registro enviado.' }, { status: 400 });

    const result = await applyStudentRows(rows);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message || err) }, { status: 500 });
  }
}
