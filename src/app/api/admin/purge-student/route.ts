import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requirePanelAdmin } from '@/lib/adminGuard';
import { autoBackupAfterChange } from '@/lib/backupAlunos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const AUTH_KEY = 'config/aluno-auth.json';
const ID_MAP_KEY = 'config/aluno-id-map.json';
const EXTRAS_KEY = 'extras/student-extras.json';
const LIXEIRA_KEY = 'config/lixeira.json';

async function loadJson(key: string): Promise<Record<string, unknown>> {
  try {
    const { data: urlData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, 30);
    if (!urlData?.signedUrl) return {};
    const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function saveJson(key: string, obj: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(key, blob, { upsert: true });
}

/**
 * POST /api/admin/purge-student
 * Exclusão DEFINITIVA de um aluno: apaga a linha do banco, a conta de acesso,
 * o mapeamento de matrícula (liberando o CCLN do aluno para reuso), os extras,
 * o registro da lixeira e as fotos/presenças do dia em storage.
 * Body: { student_id, admin_username, admin_password }
 */
export async function POST(req: NextRequest) {
  const __g = requirePanelAdmin(req);
  if (!__g.ok) return __g.res;

  try {
    const { student_id, admin_username, admin_password } = await req.json();
    if (!student_id) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });

    // Só Owner/Admin Geral podem excluir definitivamente (mesmo desafio do painel)
    const { appendAudit } = await import('@/lib/audit');
    const { hashPassword, verifyPassword } = await import('@/lib/panelCredentials');
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
      return NextResponse.json({ error: 'Apenas Owner ou Admin Geral podem excluir alunos definitivamente.' }, { status: 403 });
    }

    // 1) Snapshot do aluno (para auditoria e limpeza da lixeira)
    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id, nome_completo, ordem_inscricao, foto_url')
      .eq('id', student_id)
      .maybeSingle();
    if (!student) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });

    // 2) Excluir do banco (presenças caem por CASCADE)
    const { error: delErr } = await supabaseAdmin
      .from('students')
      .delete()
      .eq('id', student_id);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

    // 3) Limpar derivação em storage
    // 3a. Conta de acesso (login do aluno)
    const authMap = await loadJson(AUTH_KEY);
    if (authMap[student_id]) {
      delete authMap[student_id];
      await saveJson(AUTH_KEY, authMap);
    }

    // 3b. Mapa de matrículas — libera o número CCLN do aluno
    // Releitura ANTES do delete (snapshot) + regravação de merge protege contra a corrida
    // clássica: dois admins excluem alunos distintos ao mesmo tempo e um mapa sobrescreve
    // o outro, "ressuscitando" o aluno excluído no painel.
    const idMapBefore = await loadJson(ID_MAP_KEY);
    const _idMapHadKey = Object.prototype.hasOwnProperty.call(idMapBefore, student_id);
    const idMap = await loadJson(ID_MAP_KEY);
    if (idMap[student_id] || _idMapHadKey) {
      delete idMap[student_id];
      // Merge: preserva chaves criadas por escritas concorrentes desde a nossa leitura
      for (const [k, v] of Object.entries(idMapBefore)) {
        if (!idMap[k]) idMap[k] = v;
      }
      await saveJson(ID_MAP_KEY, idMap);
    }

    // 3c. Extras (apelido etc.)
    const extras = await loadJson(EXTRAS_KEY);
    if (extras[student_id]) {
      delete extras[student_id];
      await saveJson(EXTRAS_KEY, extras);
    }

    // 3d. Lixeira — exclusão definitiva remove o snapshot
    const lixeira = await loadJson(LIXEIRA_KEY);
    if (Array.isArray(lixeira)) {
      const filtered = (lixeira as Array<{ id: string }>).filter(e => e.id !== student_id);
      if (filtered.length !== lixeira.length) await saveJson(LIXEIRA_KEY, filtered);
    }

    // 3e. Fotos do aluno e checkins (presenças do dia) em storage
    const { data: fotoFiles } = await supabaseAdmin.storage.from(BUCKET).list(`fotos/${student_id}`);
    if (fotoFiles && fotoFiles.length > 0) {
      await supabaseAdmin.storage.from(BUCKET).remove(fotoFiles.map(f => `fotos/${student_id}/${f.name}`));
    }
    // checkins de hoje (arquivos antigos ficam como histórico morto; aluno não existe mais)
    try {
      const hoje = new Date().toISOString().split('T')[0];
      const { data: checkinFiles } = await supabaseAdmin.storage.from(BUCKET).list(`checkins/${hoje}`);
      const alvo = `${student_id}.json`;
      if (checkinFiles?.some(f => f.name === alvo || f.name === `${student_id}.deleted`)) {
        await supabaseAdmin.storage.from(BUCKET).remove([`checkins/${hoje}/${alvo}`, `checkins/${hoje}/${student_id}.deleted`]);
      }
    } catch {}

    await appendAudit({
      actor: key,
      actor_type: 'admin',
      action: 'aluno_excluido_definitivo',
      target_id: String(student_id),
      target_name: String(student.nome_completo || ''),
      details: { matricula_liberada: student.ordem_inscricao ?? null },
    });

    // Backup automático pós-exclusão definitiva (melhor esforço)
    try { await autoBackupAfterChange(key, 'exclusao_definitiva_aluno'); } catch {}

    return NextResponse.json({ ok: true, matricula_liberada: student.ordem_inscricao ?? null });
  } catch (err) {
    console.error('purge-student error:', err);
    return NextResponse.json({ error: 'Erro interno ao excluir aluno.' }, { status: 500 });
  }
}
