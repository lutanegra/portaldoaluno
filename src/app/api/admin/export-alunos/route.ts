import { NextRequest, NextResponse } from 'next/server';
import { fetchStudentsRaw, buildStudentsCsv } from '@/lib/backupAlunos';
import { appendAudit } from '@/lib/audit';
import { requirePanelAdmin } from '@/lib/adminGuard';

export const dynamic = 'force-dynamic';

// GET /api/admin/export-alunos?nucleo=... — CSV com todas as colunas de students
// A permissão vem SEMPRE da sessão do painel (cookie pa_admin); o parâmetro
// auth=... do cliente foi aposentado por segurança. Admin de núcleo exportar
// apenas os alunos dos próprios núcleos.
export async function GET(req: NextRequest) {
  const __g = requirePanelAdmin(req);
  if (!__g.ok) return __g.res;

  const sessao = __g.session;
  const nucleoFilter = req.nextUrl.searchParams.get('nucleo') || '';

  let students: Record<string, unknown>[] = [];
  try {
    students = await fetchStudentsRaw();
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message || err) }, { status: 500 });
  }

  if (sessao.n !== 'geral') {
    const permitidos = new Set<string>(
      [sessao.n, ...(sessao.ns || [])].map(s => String(s).toLowerCase())
    );
    students = students.filter(s => permitidos.has(String(s.nucleo || '').toLowerCase()));
  } else if (nucleoFilter) {
    students = students.filter(s => String(s.nucleo || '').toLowerCase() === nucleoFilter.toLowerCase());
  }

  const csv = buildStudentsCsv(students);
  const dateStr = new Date().toISOString().slice(0, 10);
  const suffix = nucleoFilter ? `-${nucleoFilter}` : '';

  await appendAudit({
    actor: sessao.u,
    actor_type: 'admin',
    action: 'alunos_exportados_csv',
    details: { nucleo: sessao.n === 'geral' ? (nucleoFilter || 'todos') : sessao.n, total: students.length },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="alunos-portalaluno${suffix}-${dateStr}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
