import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
  );
}

const BUCKET = 'photos';
const KEY = 'config/hierarquia.json';

export interface MembroHierarquia {
  id: string;
  nome: string;
  nucleo?: string;
  foto_url?: string | null;
}

export interface Hierarquia {
  mestres: MembroHierarquia[];
  mestrandos: MembroHierarquia[];
  professores: MembroHierarquia[];
  instrutores: MembroHierarquia[];
  monitores: MembroHierarquia[];
  alunos_graduados: MembroHierarquia[];
  updated_at: string;
}

const DEFAULT: Hierarquia = {
  mestres: [],
  mestrandos: [],
  professores: [],
  instrutores: [],
  monitores: [],
  alunos_graduados: [],
  updated_at: '',
};

export async function GET() {
  const supabaseAdmin = getAdmin();
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(KEY);
  if (error || !data) return NextResponse.json(DEFAULT);
  try { return NextResponse.json(JSON.parse(await data.text())); } catch { return NextResponse.json(DEFAULT); }
}

export async function POST(req: NextRequest) {
  // ── Autenticação: sessão do painel (owner/admin geral) OU credenciais de gestão no corpo ──
  const session = readPanelSession(req);
  let autorizado = !!(session && session.n === 'geral');
  if (!autorizado) {
    try {
      const bodyAny = await req.json();
      (req as unknown as { _cachedBody?: unknown })._cachedBody = bodyAny;
      const adminUsername = String(bodyAny.admin_username || '');
      const adminPassword = String(bodyAny.admin_password || '');
      if (adminUsername && adminPassword) {
        const { loadCreds, resolveUsername, verifyPassword, accIsGeral } = await import('@/lib/panelCredentials');
        const creds = await loadCreds();
        const key = resolveUsername(creds, adminUsername);
        const acc = key ? creds[key] : undefined;
        autorizado = !!(acc && verifyPassword(adminPassword, acc.password) && accIsGeral(acc));
      }
    } catch { /* corpo inválido — segue não autorizado */ }
  }
  if (!autorizado) {
    return NextResponse.json({ error: 'Somente Owner ou Admin Geral podem salvar a hierarquia.' }, { status: 401 });
  }

  const supabaseAdmin = getAdmin();
  const cached = (req as unknown as { _cachedBody?: Record<string, unknown> })._cachedBody;
  const body: Hierarquia = (cached as unknown as Hierarquia) || await req.json();
  delete (body as unknown as Record<string, unknown>).admin_username;
  delete (body as unknown as Record<string, unknown>).admin_password;
  body.updated_at = new Date().toISOString();
  const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(KEY, blob, { upsert: true, contentType: 'application/json' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: body });
}
