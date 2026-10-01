import { NextRequest, NextResponse } from 'next/server';
import {
  getBackupStatus,
  runBackupSistema,
  restoreBackupSistema,
  deleteBackup,
  saveSettings,
  type BackupSettings,
} from '@/lib/backupSistema';
import { requireGeralAdmin } from '@/lib/adminGuard';

/**
 * Gerenciamento do backup completo do sistema — só Owner/Admin Geral.
 * GET    → status + histórico + configurações
 * POST   → "Fazer backup agora"
 * PATCH  → salvar configurações (frequência, retenção…)
 * PUT    → restaurar uma cópia (após backup automático do estado atual)
 * DELETE → excluir uma cópia do histórico
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  const status = await getBackupStatus();
  return NextResponse.json({ ok: true, ...status });
}

export async function POST(req: NextRequest) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  const r = await runBackupSistema({ tipo: 'manual', gatilho: 'botao_painel', actor: __g.session.u });
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 500 });
  return NextResponse.json({ ok: true, item: r.item });
}

export async function PATCH(req: NextRequest) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  try {
    const body = (await req.json()) as Partial<BackupSettings>;
    const patch: Partial<BackupSettings> = {};
    if (typeof body.automatico === 'boolean') patch.automatico = body.automatico;
    if (body.frequencia && ['6h', 'diario', '3dias', 'semanal'].includes(body.frequencia)) {
      patch.frequencia = body.frequencia;
    }
    if (typeof body.horario === 'string') patch.horario = body.horario;
    if (body.manter !== undefined) patch.manter = Number(body.manter);
    if (body.manter_dias !== undefined) {
      patch.manter_dias = body.manter_dias === null ? null : Number(body.manter_dias);
    }
    const settings = await saveSettings(patch, __g.session.u);
    return NextResponse.json({ ok: true, settings });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 400 });
  }
}

export async function PUT(req: NextRequest) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  try {
    const { filename, confirmacao } = await req.json();
    if (!filename || String(confirmacao || '').trim().toUpperCase() !== 'RESTAURAR') {
      return NextResponse.json({ ok: false, error: 'Confirmação inválida — nada foi alterado.' }, { status: 400 });
    }
    // Rede de segurança: snapshot do estado atual ANTES de substituir tudo.
    await runBackupSistema({ tipo: 'pre_restauracao', gatilho: `antes de restaurar ${String(filename).split('/').pop()}`, actor: __g.session.u });
    const resultado = await restoreBackupSistema(String(filename), __g.session.u);
    return NextResponse.json({ ok: true, resultado });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const __g = requireGeralAdmin(req);
  if (!__g.ok) return __g.res;
  try {
    const { filename } = await req.json();
    if (!filename) return NextResponse.json({ ok: false, error: 'filename obrigatório.' }, { status: 400 });
    await deleteBackup(String(filename), __g.session.u);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String((err as Error)?.message || err) }, { status: 400 });
  }
}
