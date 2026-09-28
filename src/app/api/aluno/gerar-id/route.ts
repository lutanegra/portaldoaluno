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
const ID_PREFIX = 'CCLN';

// O banco (students.ordem_inscricao) é a fonte da verdade. O mapa no Storage
// existe só por compatibilidade com telas antigas e é reescrito a partir dele.
function formatId(n: number): string {
  return `${ID_PREFIX}-${String(n).padStart(3, '0')}`;
}

async function maxOrdem(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('students')
    .select('ordem_inscricao')
    .not('ordem_inscricao', 'is', null)
    .order('ordem_inscricao', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.ordem_inscricao ?? 0;
}

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
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(ID_MAP_KEY, blob, { upsert: true });
}

// Reconstrói o mapa do Storage a partir da numeração oficial do banco
async function rebuildMapFromDb(): Promise<Record<string, string>> {
  const { data: students } = await supabaseAdmin
    .from('students')
    .select('id, ordem_inscricao')
    .not('ordem_inscricao', 'is', null)
    .order('ordem_inscricao', { ascending: true });
  const map: Record<string, string> = {};
  for (const s of students || []) {
    if (s.ordem_inscricao != null) map[s.id] = formatId(s.ordem_inscricao);
  }
  await saveIdMap(map);
  return map;
}

// GET: get display ID for a student UUID, or the full map
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const student_id = searchParams.get('student_id');

  if (student_id) {
    // Banco primeiro, mapa antigo como fallback
    const { data: row } = await supabaseAdmin
      .from('students')
      .select('ordem_inscricao')
      .eq('id', student_id)
      .maybeSingle();
    if (row?.ordem_inscricao != null) {
      return NextResponse.json({ display_id: formatId(row.ordem_inscricao) });
    }
    const idMap = await loadIdMap();
    if (idMap[student_id]) {
      return NextResponse.json({ display_id: idMap[student_id] });
    }
    return NextResponse.json({ display_id: null });
  }

  // Return full map rebuilt from DB
  const map = await rebuildMapFromDb();
  return NextResponse.json(map);
}

// POST: assign ID to a student (or generate for all without one)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, student_id } = body;

  if (action === 'assign') {
    if (!student_id) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });

    // Já numerado? Mantém (nunca repete nem reordena)
    const { data: row } = await supabaseAdmin
      .from('students')
      .select('ordem_inscricao')
      .eq('id', student_id)
      .maybeSingle();
    if (row?.ordem_inscricao != null) {
      return NextResponse.json({ display_id: formatId(row.ordem_inscricao), already_exists: true });
    }

    const nextId = (await maxOrdem()) + 1;
    const { error } = await supabaseAdmin
      .from('students')
      .update({ ordem_inscricao: nextId })
      .eq('id', student_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await rebuildMapFromDb();
    return NextResponse.json({ display_id: formatId(nextId), id_num: nextId });
  }

  if (action === 'bulk-assign') {
    // Numerar todos sem número, em ordem de chegada (created_at)
    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, created_at')
      .is('ordem_inscricao', null)
      .order('created_at', { ascending: true });

    if (!students?.length) {
      await rebuildMapFromDb();
      return NextResponse.json({ assigned: 0 });
    }

    let nextId = await maxOrdem();
    for (const s of students) {
      nextId++;
      await supabaseAdmin.from('students').update({ ordem_inscricao: nextId }).eq('id', s.id);
    }

    await rebuildMapFromDb();
    return NextResponse.json({ assigned: students.length });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
