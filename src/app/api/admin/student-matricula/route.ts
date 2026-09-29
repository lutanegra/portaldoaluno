import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const ID_MAP_KEY = 'config/aluno-id-map.json';

async function loadIdMap(): Promise<Record<string, string>> {
  try {
    const { data: urlData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(ID_MAP_KEY, 30);
    if (!urlData?.signedUrl) return {};
    const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveIdMap(map: Record<string, string>): Promise<void> {
  const blob = new Blob([JSON.stringify(map)], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(ID_MAP_KEY, blob, { upsert: true });
}

function formatId(n: number): string {
  return `CCLN-${String(n).padStart(3, '0')}`;
}

/**
 * POST /api/admin/student-matricula
 * Define/altera a matrícula CCLN de um aluno.
 * Body: { student_id, novo_numero, admin_username, admin_password }
 */
export async function POST(req: NextRequest) {
  try {
    const { student_id, novo_numero, admin_username, admin_password } = await req.json();
    const numero = parseInt(String(novo_numero), 10);
    if (!student_id || !Number.isFinite(numero) || numero < 1 || numero > 999) {
      return NextResponse.json({ error: 'Informe um número de matrícula entre 001 e 999.' }, { status: 400 });
    }

    // Desafio: só Owner/Admin Geral
    const { appendAudit } = await import('@/lib/audit');
    const { verifyPassword } = await import('@/lib/panelCredentials');
    const CREDS_KEY = 'config/panel-credentials.json';
    const credsUrl = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(CREDS_KEY, 30);
    let creds: Record<string, { nucleo: string; password: string }> = {};
    if (credsUrl.data?.signedUrl) {
      try {
        const r = await fetch(credsUrl.data.signedUrl, { cache: 'no-store' });
        if (r.ok) creds = await r.json();
      } catch {}
    }
    const key = String(admin_username || '').trim().toLowerCase();
    const user = creds[key];
    if (!user || user.nucleo !== 'geral' || !admin_password || !verifyPassword(String(admin_password), user.password)) {
      return NextResponse.json({ error: 'Apenas Owner ou Admin Geral podem alterar matrículas.' }, { status: 403 });
    }

    // Aluno precisa existir
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, ordem_inscricao')
      .eq('id', student_id)
      .maybeSingle();
    if (!student) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });

    // Número precisa estar livre
    const { data: conflito } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo')
      .eq('ordem_inscricao', numero)
      .neq('id', student_id)
      .maybeSingle();
    if (conflito) {
      return NextResponse.json({ error: `A matrícula ${formatId(numero)} já pertence a ${conflito.nome_completo}.` }, { status: 409 });
    }

    // Atualiza o banco
    const { error: upErr } = await supabaseAdmin
      .from('students')
      .update({ ordem_inscricao: numero })
      .eq('id', student_id);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    // Sincroniza o mapa de compatibilidade
    const idMap = await loadIdMap();
    delete idMap[student_id];
    idMap[student_id] = formatId(numero);
    await saveIdMap(idMap);

    await appendAudit({
      actor: key,
      actor_type: 'admin',
      action: 'matricula_alterada',
      target_id: String(student_id),
      target_name: String(student.nome_completo || ''),
      details: { de: student.ordem_inscricao ?? null, para: numero },
    });

    return NextResponse.json({ ok: true, display_id: formatId(numero), anterior: student.ordem_inscricao ?? null });
  } catch (err) {
    console.error('student-matricula error:', err);
    return NextResponse.json({ error: 'Erro interno ao alterar matrícula.' }, { status: 500 });
  }
}
