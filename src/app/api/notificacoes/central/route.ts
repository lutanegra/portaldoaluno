// Centro de notificações + preferências (aluno/responsável autenticado).
// - GET            → { nao_lidas, items (50 recentes), preferencias, dispositivos }
// - POST action=ler             → marca uma notificação como lida
// - POST action=ler-todas       → marca todas como lidas
// - POST action=preferencias    → salva os interrupts (segurança não é configurável)
// - POST action=teste           → envia um push real para os dispositivos da conta
import { NextRequest, NextResponse } from 'next/server';
import { readAlunoSessionFromReq } from '@/lib/alunoSession';
import { createClient } from '@supabase/supabase-js';
import {
  criarNotificacao,
  isCategoryRequired,
  NOTIFICATION_CATEGORIES,
} from '@/lib/push/notifications';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const PREF_MAP: Record<string, string> = {
  mural: 'mural_enabled',
  eventos: 'events_enabled',
  presenca: 'attendance_enabled',
  justificativas: 'justification_enabled',
  graduacao: 'graduation_enabled',
  responsaveis: 'guardian_enabled',
  sistema: 'system_enabled',
};

export async function GET(req: NextRequest) {
  const sess = readAlunoSessionFromReq(req);
  if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const uid = sess.sid;

  const [{ data: items, error }, { data: prefs }, { data: dispositivos }] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, type, category, title, message, read_at, created_at, target_type, target_id')
      .eq('recipient_user_id', uid)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('notification_preferences')
      .select('mural_enabled, events_enabled, attendance_enabled, justification_enabled, graduation_enabled, guardian_enabled, system_enabled, updated_at')
      .eq('user_id', uid)
      .maybeSingle(),
    supabase
      .from('push_subscriptions')
      .select('id, device_name, created_at, last_seen_at, active, user_agent')
      .eq('user_id', uid)
      .order('last_seen_at', { ascending: false }),
  ]);
  if (error) return NextResponse.json({ error: 'Falha ao carregar notificações.' }, { status: 500 });

  const naoLidas = (items || []).filter(n => !n.read_at).length;
  return NextResponse.json({
    nao_lidas: naoLidas,
    items: items || [],
    preferencias: prefs || null,
    obrigatorias: NOTIFICATION_CATEGORIES.filter(c => isCategoryRequired(c)),
    dispositivos: dispositivos || [],
  });
}

export async function POST(req: NextRequest) {
  const sess = readAlunoSessionFromReq(req);
  if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const uid = sess.sid;
  const body = await req.json().catch(() => null) as { action?: string; id?: string; preferencias?: Record<string, boolean> } | null;
  const action = body?.action || '';

  if (action === 'ler') {
    const id = String(body?.id || '');
    if (!id) return NextResponse.json({ error: 'Informe a notificação.' }, { status: 400 });
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).eq('recipient_user_id', uid);
    return NextResponse.json({ ok: true });
  }

  if (action === 'ler-todas') {
    await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_user_id', uid)
      .is('read_at', null);
    return NextResponse.json({ ok: true });
  }

  if (action === 'preferencias') {
    const prefs = body?.preferencias || {};
    const patch: Record<string, boolean> = {};
    for (const [cat, col] of Object.entries(PREF_MAP)) {
      if (typeof prefs[cat] === 'boolean') patch[col] = prefs[cat];
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 });
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: uid, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) return NextResponse.json({ error: 'Não foi possível salvar as preferências.' }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'teste') {
    const res = await criarNotificacao({
      userId: uid,
      category: 'sistema',
      type: 'teste',
      title: 'Notificação de teste',
      message: 'Esta é uma notificação de teste. Se você a recebeu, o push está funcionando.',
      targetType: '',
      targetId: '',
      pushTitle: 'Ginga Gestão',
      pushBody: 'Esta é uma notificação de teste.',
    });
    return NextResponse.json({ ok: true, ...res });
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
