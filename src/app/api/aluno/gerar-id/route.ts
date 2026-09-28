import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const COUNTER_KEY = 'config/aluno-id-counter.json';
const ID_MAP_KEY = 'config/aluno-id-map.json';
const ID_PREFIX = 'CCLN';

// Sequential ID counter — never repeats, always incrementing
async function getNextId(): Promise<number> {
  try {
    const { data: urlData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(COUNTER_KEY, 30);
    if (urlData?.signedUrl) {
      const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return (data.last_id || 0) + 1;
      }
    }
  } catch {}
  return 1;
}

async function saveCounter(id: number): Promise<void> {
  const blob = new Blob([JSON.stringify({ last_id: id })], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(COUNTER_KEY, blob, { upsert: true });
}

// Maps student UUID -> sequential display ID (CCLN-000 format)
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

function formatId(n: number): string {
  return `CCLN-${String(n).padStart(3, '0')}`;
}

// GET: get display ID for a student UUID, or generate if not exists
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const student_id = searchParams.get('student_id');

  const idMap = await loadIdMap();

  if (student_id) {
    if (idMap[student_id]) {
      return NextResponse.json({ display_id: idMap[student_id] });
    }
    return NextResponse.json({ display_id: null });
  }

  // Return full map
  return NextResponse.json(idMap);
}

// POST: assign ID to a student (or generate for all without one)
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, student_id } = body;

  if (action === 'assign') {
    // Assign a new sequential ID to a specific student
    if (!student_id) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });

    const idMap = await loadIdMap();
    if (idMap[student_id]) {
      return NextResponse.json({ display_id: idMap[student_id], already_exists: true });
    }

    const nextId = await getNextId();
    const displayId = formatId(nextId);
    idMap[student_id] = displayId;
    await Promise.all([saveIdMap(idMap), saveCounter(nextId)]);
    return NextResponse.json({ display_id: displayId, id_num: nextId });
  }

  if (action === 'bulk-assign') {
    // Assign IDs to all students that don't have one yet, in arrival order
    const { data: students } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, nucleo, created_at')
      .order('created_at', { ascending: true });

    if (!students?.length) return NextResponse.json({ assigned: 0 });

    const idMap = await loadIdMap();
    let nextId = await getNextId() - 1; // Will increment for each new assignment
    let assigned = 0;

    for (const s of students) {
      if (!idMap[s.id]) {
        nextId++;
        idMap[s.id] = formatId(nextId);
        assigned++;
      }
    }

    if (assigned > 0) {
      await Promise.all([saveIdMap(idMap), saveCounter(nextId)]);
    }

    return NextResponse.json({ assigned });
  }

  return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
}
