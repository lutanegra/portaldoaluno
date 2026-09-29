import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const AUTH_KEY = 'config/aluno-auth.json';
const ID_MAP_KEY = 'config/aluno-id-map.json';

async function loadFromStorage(key: string): Promise<Record<string, unknown>> {
  try {
    const { data: urlData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, 30);
    if (!urlData?.signedUrl) return {};
    const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

export async function GET() {
  try {
    const [authMap, idMap] = await Promise.all([
      loadFromStorage(AUTH_KEY),
      loadFromStorage(ID_MAP_KEY),
    ]);

    const safe = Object.values(authMap).map((acc: any) => ({
      student_id: acc.student_id,
      username: acc.username,
      email: acc.email,
      active: acc.active,
      phone: acc.phone,
      created_at: acc.created_at,
      last_login: acc.last_login,
      display_id: (idMap as Record<string, string>)[acc.student_id] || null,
    }));

    return NextResponse.json(safe);
  } catch {
    return NextResponse.json([]);
  }
}

// PUT /api/aluno/contas — atualiza o e-mail da conta de um aluno.
// Chamado por "Meus Dados" quando o aluno salva um e-mail no perfil:
// mantém a conta (login/recuperação) alinhada com o cadastro.
export async function PUT(req: Request) {
  try {
    const { student_id, email } = await req.json();
    if (!student_id || typeof email !== 'string') {
      return NextResponse.json({ error: 'student_id e email são obrigatórios.' }, { status: 400 });
    }
    const clean = email.trim().toLowerCase();
    if (clean && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
    }

    const authMap = (await loadFromStorage(AUTH_KEY)) as Record<string, Record<string, unknown>>;
    const entry = Object.values(authMap).find((a: any) => a?.student_id === student_id) as Record<string, unknown> | undefined;
    const entryKey = Object.keys(authMap).find(k => (authMap[k] as any)?.student_id === student_id);

    if (clean && entry && entryKey) {
      authMap[entryKey] = { ...entry, email: clean };
      const blob = new Blob([JSON.stringify(authMap)], { type: 'application/json' });
      await supabaseAdmin.storage.from(BUCKET).upload(AUTH_KEY, blob, { upsert: true });
    }
    return NextResponse.json({ ok: true, synced: !!clean && !!entryKey });
  } catch {
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
