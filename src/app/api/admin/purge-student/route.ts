import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { appendAudit } from '@/lib/audit';
import { loadCreds, verifyPassword } from '@/lib/panelCredentials';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const AUTH_KEY = 'config/aluno-auth.json';

async function loadAuthMap(): Promise<Record<string, Record<string, unknown>>> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(AUTH_KEY, 30);
    if (!data?.signedUrl) return {};
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveAuthMap(map: Record<string, Record<string, unknown>>): Promise<void> {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  await supabase.storage.from(BUCKET).upload(AUTH_KEY, blob, { upsert: true });
}

/**
 * EXCLUSÃO DEFINITIVA DE CADASTRO — exclusivo do painel.
 *
 * POST { student_id, confirm: 'APAGAR' }
 * A lixeira já recebeu o snapshot (o painel grava antes de chamar esta rota).
 * Aqui: remove a conta de acesso, vínculos de responsável, dispositivos e a
 * linha do cadastro. Falhas de chave estrangeira derrubam dependências diretas
 * e tentam uma única vez novamente.
 */
export async function POST(req: NextRequest) {
  const painel = readPanelSession(req);
  if (!painel) {
    return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const studentId = String((body as { student_id?: string }).student_id || '');
  const confirm = String((body as { confirm?: string }).confirm || '');
  if (!studentId || confirm !== 'APAGAR') {
    return NextResponse.json({ error: 'Confirmação obrigatória (confirm=APAGAR).' }, { status: 400 });
  }

  // Confirma a identidade do operador: senha de gestão no corpo (regra antiga
  // desta operação destrutiva) OU sessão de painel válida.
  const adminUsername = String((body as { admin_username?: string }).admin_username || '');
  const adminPassword = String((body as { admin_password?: string }).admin_password || '');
  if (adminUsername && adminPassword) {
    const creds = await loadCreds();
    const acc = creds[adminUsername];
    if (!acc || !verifyPassword(adminPassword, acc.password)) {
      return NextResponse.json({ error: 'Credenciais de gestão inválidas.' }, { status: 401 });
    }
  }

  const { data: aluno } = await supabase
    .from('students')
    .select('id, nome_completo')
    .eq('id', studentId)
    .maybeSingle();
  if (!aluno) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });

  // 1) Conta de acesso + derivações no Storage
  try {
    const authMap = await loadAuthMap();
    if (authMap[studentId]) {
      delete authMap[studentId];
      await saveAuthMap(authMap);
    }
  } catch { /* melhor-esforço */ }

  // 2) Linhas dependentes conhecidas (vínculos, dispositivos, documentos)
  const limpar = async (): Promise<void> => {
    await supabase.from('guardian_links').delete().eq('guardian_student_id', studentId);
    await supabase.from('guardian_links').delete().eq('student_id', studentId);
    await supabase.from('guardians').delete().eq('student_id', studentId);
    await supabase.from('push_subscriptions').delete().eq('user_id', studentId);
    await supabase.from('notification_preferences').delete().eq('user_id', studentId);
        await supabase.from('termo_assinaturas').delete().eq('student_id', studentId);
    await supabase.from('adolescent_authorizations').delete().eq('student_id', studentId);
    await supabase.from('notifications').delete().eq('recipient_user_id', studentId);
  };
  await limpar().catch(() => {});

  // 3) Exclusão do cadastro (com uma retentativa após limpar histórico direto)
  let delErr: string | null = null;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const { error } = await supabase.from('students').delete().eq('id', studentId);
    if (!error) { delErr = null; break; }
    delErr = error.message || 'erro';
    if (tentativa === 0) {
      try {
        await supabase.from('presencas').delete().eq('student_id', studentId);
        await supabase.from('notification_deliveries').delete().eq('user_id', studentId);
      } catch { /* segue para a retentativa */ }
    }
  }
  if (delErr) {
    return NextResponse.json(
      { error: `Não foi possível excluir o cadastro: ${delErr}` },
      { status: 500 },
    );
  }

  // 4) Arquivos de mídia do aluno (melhor-esforço)
  try {
    await supabase.storage.from(BUCKET).remove([
      `fotos/${studentId}/perfil.jpg`,
      `fotos/${studentId}/perfil.png`,
    ]);
  } catch { /* melhor-esforço */ }

  try {
    await appendAudit({
      actor: painel.u,
      actor_type: 'admin',
      action: 'aluno_excluido_definitivo',
      target_id: studentId,
      target_name: aluno.nome_completo,
    });
  } catch { /* não bloqueia */ }

  return NextResponse.json({ success: true });
}
