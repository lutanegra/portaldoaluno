import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos } from '@/lib/panelCredentials';
import { datasComChamada } from '@/lib/chamada';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

// GET /api/chamada/datas?nucleo=slug
// Datas que possuem chamada ou registros avulsos para o núcleo (mais recentes primeiro).
export async function GET(req: Request) {
  const sess = readPanelSession(req);
  if (!sess) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
  const creds = await loadCreds();
  const acc = creds[sess.u];
  if (!acc) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });

  const nucleoSlug = new URL(req.url).searchParams.get('nucleo') || acc.nucleo;
  const geral = accIsGeral(acc);
  if (!geral && !accNucleos(acc).includes(nucleoSlug)) {
    return NextResponse.json({ error: 'Núcleo fora da sua permissão.' }, { status: 403 });
  }

  const datas = await datasComChamada(nucleoSlug);
  return NextResponse.json({ datas });
}
