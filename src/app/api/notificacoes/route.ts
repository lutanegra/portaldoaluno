// Rotas do sistema de notificações (aluno/responsável autenticado).
// - GET  ?action=state    → suporte push + chave VAPID pública + estado do navegador
// - POST action=subscribe → registra/atualiza a subscription deste dispositivo
// - POST action=unsubscribe → desativa a subscription deste navegador
// Toda identidade vem do cookie de sessão — o frontend nunca informa user_id.
import { NextRequest, NextResponse } from 'next/server';
import { readAlunoSessionFromReq } from '@/lib/alunoSession';
import {
  VAPID_PUBLIC_KEY,
  upsertSubscription,
  revogarSubscription,
  derivaNomeDispositivo,
  appendNotificationAudit,
} from '@/lib/push/notifications';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sess = readAlunoSessionFromReq(req);
  if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const ua = req.headers.get('user-agent') || '';
  const isIOS = /iPhone|iPad|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return NextResponse.json({
    vapidPublicKey: VAPID_PUBLIC_KEY,
    supported: typeof VAPID_PUBLIC_KEY === 'string' && VAPID_PUBLIC_KEY.length > 0,
    ios: isIOS,
  });
}

export async function POST(req: NextRequest) {
  const sess = readAlunoSessionFromReq(req);
  if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

  const body = await req.json().catch(() => null) as {
    action?: string;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    expirationTime?: number | null;
    subscription_id?: string;
    sem_conta?: boolean;
  } | null;
  const action = body?.action || '';

  if (action === 'subscribe') {
    const endpoint = String(body?.endpoint || '');
    const p256dh = String(body?.keys?.p256dh || '');
    const auth = String(body?.keys?.auth || '');
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'Subscription incompleta.' }, { status: 400 });
    }
    const res = await upsertSubscription({
      userId: sess.sid,
      endpoint,
      p256dh,
      auth,
      expirationTime: typeof body?.expirationTime === 'number' ? body.expirationTime : null,
      userAgent: req.headers.get('user-agent') || '',
    });
    if (!res.ok) return NextResponse.json({ error: res.error || 'Falha ao registrar o dispositivo.' }, { status: 500 });
    return NextResponse.json({ ok: true, id: res.id });
  }

  if (action === 'unsubscribe' || action === 'unsubscribe-by-endpoint') {
    // Por id (gerência de dispositivos) ou por endpoint (logout do navegador —
    // o cliente não precisa decorar ids).
    const endpoint = String(body?.endpoint || '');
    if (action === 'unsubscribe-by-endpoint' && endpoint) {
      const { createClient } = await import('@supabase/supabase-js');
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
        process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
      );
      const deslogado = body?.sem_conta === true;
      if (deslogado) {
        // Sem sessão (logout já derrubou o cookie): revoga qualquer associação
        // deste endpoint — identidade futura será revalidada no próximo login.
        await admin
          .from('push_subscriptions')
          .update({ active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('endpoint', endpoint);
        return NextResponse.json({ ok: true });
      }
      const { data: alvo } = await admin
        .from('push_subscriptions')
        .select('id, user_id')
        .eq('endpoint', endpoint)
        .maybeSingle();
      if (!alvo || alvo.user_id !== sess.sid) return NextResponse.json({ ok: true });
      await revogarSubscription(alvo.id, sess.sid);
      return NextResponse.json({ ok: true });
    }
    const id = String(body?.subscription_id || '');
    if (!id) return NextResponse.json({ error: 'Informe o dispositivo.' }, { status: 400 });
    const ok = await revogarSubscription(id, sess.sid);
    if (ok) await appendNotificationAudit(sess.sid, 'dispositivo_revogado', { id });
    return NextResponse.json({ ok });
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
