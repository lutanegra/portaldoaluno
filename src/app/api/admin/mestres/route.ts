import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);
const BUCKET = 'photos';
const KEY = 'config/mestres.json';

export interface Mestre {
  id: string;
  nome: string;
  biografia?: string;
  foto_url?: string | null;
}

async function loadMestres(): Promise<Mestre[]> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(KEY, 30);
    if (!data?.signedUrl) return [];
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

async function saveMestres(list: Mestre[]): Promise<void> {
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(KEY, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw new Error(error.message);
}

// GET /api/admin/mestres — lista os mestres cadastrados
export async function GET() {
  const mestres = await loadMestres();
  return NextResponse.json({ mestres });
}

// POST /api/admin/mestres — salva a lista completa (add/remove/rename)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mestres = body.mestres;
    if (!Array.isArray(mestres)) {
      return NextResponse.json({ error: 'Lista de mestres inválida.' }, { status: 400 });
    }
    const limpa: Mestre[] = mestres
      .map((m: Partial<Mestre>, i: number) => ({
        id: String(m.id || `mestre_${Date.now()}_${i}`),
        nome: String(m.nome || '').trim(),
        biografia: typeof m.biografia === 'string' ? m.biografia : undefined,
        foto_url: typeof m.foto_url === 'string' ? m.foto_url : null,
      }))
      .filter(m => m.nome.length > 0);
    await saveMestres(limpa);
    return NextResponse.json({ ok: true, mestres: limpa });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
