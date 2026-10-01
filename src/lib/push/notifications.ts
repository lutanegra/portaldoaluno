/**
 * NÚCLEO DO SISTEMA DE NOTIFICAÇÕES — Ginga Gestão
 *
 * Tabelas: notifications, notification_deliveries, notification_preferences,
 * push_subscriptions (ver supabase/migrations).
 *
 * Identidade: a conta do app é sempre uma linha em `students` (conta de adulto:
 * aluno 18+, adolescente autorizado ou responsável). Tutelado sem conta NÃO
 * recebe notificação própria — quem acompanha é o responsável via guardian_links.
 *
 * Categorias: seguranca é OBRIGATÓRIA (nunca respeita preferência).
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

export const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || '').trim();
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT || 'mailto:contato@gingagestao.com').trim();

export const ORG_NAME = 'Ginga Gestão';

/* ── Categorias ──────────────────────────────────────────────────────────── */

export const NOTIFICATION_CATEGORIES = [
  'seguranca',
  'mural',
  'eventos',
  'presenca',
  'justificativas',
  'graduacao',
  'responsaveis',
  'sistema',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** Somente segurança é obrigatória — no backend, nunca só na UI. */
export function isCategoryRequired(cat: string): boolean {
  return cat === 'seguranca';
}

/** Coluna da preferência correspondente a cada categoria configurável. */
const PREF_COLUMN: Record<Exclude<NotificationCategory, 'seguranca'>, string> = {
  mural: 'mural_enabled',
  eventos: 'events_enabled',
  presenca: 'attendance_enabled',
  justificativas: 'justification_enabled',
  graduacao: 'graduation_enabled',
  responsaveis: 'guardian_enabled',
  sistema: 'system_enabled',
};

export async function categoriaPermitidaPara(userId: string, category: string): Promise<boolean> {
  if (isCategoryRequired(category)) return true;
  const col = PREF_COLUMN[category as Exclude<NotificationCategory, 'seguranca'>];
  if (!col) return true;
  const { data } = await supabase
    .from('notification_preferences')
    .select(col)
    .eq('user_id', userId)
    .maybeSingle();
  // Padrão: tudo ligado (linha ausente = recebe).
  return data ? Boolean((data as unknown as Record<string, unknown>)[col]) : true;
}

/* ── Dispositivos (subscriptions) ────────────────────────────────────────── */

export type SubscriptionInput = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expirationTime?: number | null;
  userAgent?: string;
};

/**
 * Registra/atualiza a subscription do navegador. Regra de segurança: o MESMO
 * endpoint nunca serve a dois usuários — ao logar outra conta no dispositivo,
 * a associação antiga é revogada (item 5 do fluxo de logout).
 */
export async function upsertSubscription(input: SubscriptionInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!input?.endpoint || !input.p256dh || !input.auth) return { ok: false, error: 'Subscription inválida.' };
  const ua = String(input.userAgent || '').slice(0, 320);
  const deviceName = derivaNomeDispositivo(ua);
  const now = new Date().toISOString();
  const { data: existente } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, active')
    .eq('endpoint', input.endpoint)
    .maybeSingle();
  if (existente) {
    if (existente.user_id !== input.userId) {
      // Dispositivo trocou de conta: desassocia do usuário anterior.
      await supabase
        .from('push_subscriptions')
        .update({ user_id: input.userId, active: true, revoked_at: null, updated_at: now, last_seen_at: now })
        .eq('id', existente.id);
      await appendNotificationAudit(input.userId, 'push_revinculado', { device: deviceName });
      return { ok: true, id: existente.id };
    }
    const { data: upd, error } = await supabase
      .from('push_subscriptions')
      .update({ p256dh: input.p256dh, auth: input.auth, active: true, revoked_at: null, last_seen_at: now, updated_at: now, device_info: ua, device_name: deviceName, expiration_time: input.expirationTime ?? null })
      .eq('id', existente.id)
      .select('id')
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: upd?.id };
  }
  const { data: ins, error } = await supabase
    .from('push_subscriptions')
    .insert({
      user_id: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      expiration_time: input.expirationTime ?? null,
      device_info: ua,
      device_name: deviceName,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: ins?.id };
}

/**Marca a subscription como revogada (logout do dispositivo / revogação manual). */
export async function revogarSubscription(id: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('push_subscriptions')
    .update({ active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();
  return !!data;
}

export function derivaNomeDispositivo(ua: string): string {
  const v = String(ua || '');
  const isIOS = /iPhone|iPad|iPod/i.test(v);
  const isAndroid = /Android/i.test(v);
  const browser = /Edg\//i.test(v) ? 'Edge' : /Chrome\//i.test(v) && !/Edg|OPR/i.test(v) ? 'Chrome' : /Firefox\//i.test(v) ? 'Firefox' : /Safari\//i.test(v) ? 'Safari' : 'Navegador';
  if (isIOS) return `${/iPad|iPod/.test(v) ? 'iPad' : 'iPhone'} · ${browser}`;
  if (isAndroid) return `Android · ${browser}`;
  if (/Windows/i.test(v)) return `Windows · ${browser}`;
  if (/Macintosh|Mac OS/i.test(v)) return `Mac · ${browser}`;
  if (/Linux/i.test(v)) return `Linux · ${browser}`;
  return browser;
}

/* ── Criação de notificação + despacho ───────────────────────────────────── */

export type NovaNotificacao = {
  userId: string;
  category: NotificationCategory;
  type: string;
  title: string;
  message?: string;
  targetType?: string;   // mural | evento | justificativa | graduacao | vinculo | conta
  targetId?: string;
  dedupeKey?: string;    // idempotência (ex.: mural:{id}:{userId})
  metadata?: Record<string, unknown>;
  pushTitle?: string;    // título curto na tela bloqueada (sem dados sensíveis)
  pushBody?: string;     // corpo curto na tela bloqueada
};

export type DespachoResultado = {
  criadas: number;
  pushesOk: number;
  pushesFalha: number;
};

/**
 * Cria a notificação lógica (idempotente por dedupe_key) e envia push para
 * todos os dispositivos ativos. Uma falha de envio não interrompe os demais.
 */
export async function criarNotificacao(n: NovaNotificacao): Promise<DespachoResultado> {
  const out: DespachoResultado = { criadas: 0, pushesOk: 0, pushesFalha: 0 };
  if (!n?.userId || !n.title) return out;
  if (!(await categoriaPermitidaPara(n.userId, n.category))) return out;

  let notifId: string | null = null;
  const dedupe = n.dedupeKey || null;
  if (dedupe) {
    const { data: existente } = await supabase
      .from('notifications')
      .select('id')
      .eq('dedupe_key', dedupe)
      .maybeSingle();
    if (existente) notifId = existente.id;
  }
  if (!notifId) {
    const { data: ins, error } = await supabase
      .from('notifications')
      .insert({
        recipient_user_id: n.userId,
        type: n.type || 'generico',
        category: n.category,
        title: n.title,
        message: n.message || '',
        target_type: n.targetType || '',
        target_id: n.targetId || '',
        dedupe_key: dedupe,
        metadata: n.metadata || {},
      })
      .select('id')
      .single();
    if (error) {
      // Corrida de duplicidade: outro processo criou primeiro.
      if (dedupe && /duplicate|unique/i.test(error.message || '')) {
        const { data: dup } = await supabase.from('notifications').select('id').eq('dedupe_key', dedupe).maybeSingle();
        if (dup) notifId = dup.id;
      }
      if (!notifId) { console.error('[notifications] insert falhou:', error.message); return out; }
    } else {
      notifId = ins.id;
      out.criadas = 1;
    }
  }

  // Push para todos os dispositivos ativos (best-effort, isolado por device)
  const titulo = n.pushTitle || n.title;
  const corpo = n.pushBody || n.message || 'Você recebeu uma nova atualização no Ginga Gestão.';
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', n.userId)
    .eq('active', true);
  for (const s of subs || []) {
    const { data: entrega, error: dErr } = await supabase
      .from('notification_deliveries')
      .insert({ notification_id: notifId, channel: 'push', status: 'pending', subscription_id: s.id })
      .select('id')
      .single();
    const entregaId = entrega?.id || null;
    try {
      const { sendWebPush } = await import('./webpush');
      const res = await sendWebPush(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        { title: `${ORG_NAME}`, body: corpo, tag: notifId || undefined, url: urlDeDestino(n.targetType, n.targetId, n.metadata) },
        { subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY },
      );
      if (entregaId) {
        await supabase
          .from('notification_deliveries')
          .update({ status: res.ok ? 'sent' : res.expired ? 'expired' : 'failed', sent_at: new Date().toISOString(), error: res.error || null })
          .eq('id', entregaId);
      }
      if (res.expired) {
        // Subscription morta: não acumula tentativas futuras.
        await supabase
          .from('push_subscriptions')
          .update({ active: false, revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', s.id);
      }
      if (res.ok) out.pushesOk++; else out.pushesFalha++;
    } catch (e) {
      if (entregaId) {
        await supabase
          .from('notification_deliveries')
          .update({ status: 'failed', sent_at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) })
          .eq('id', entregaId);
      }
      out.pushesFalha++;
    }
  }
  return out;
}

/** Notifica vários destinatários em paralelo (falha individual isolada). */
export async function notificarVarios(destinatarios: string[], n: Omit<NovaNotificacao, 'userId' | 'dedupeKey'> & { dedupeKey?: (userId: string) => string }): Promise<DespachoResultado> {
  const resultados = await Promise.all(
    Array.from(new Set(destinatarios.filter(Boolean))).map(uid =>
      criarNotificacao({ ...n, userId: uid, dedupeKey: n.dedupeKey ? n.dedupeKey(uid) : undefined }),
    ),
  );
  return resultados.reduce((acc, r) => ({
    criadas: acc.criadas + r.criadas,
    pushesOk: acc.pushesOk + r.pushesOk,
    pushesFalha: acc.pushesFalha + r.pushesFalha,
  }), { criadas: 0, pushesOk: 0, pushesFalha: 0 });
}

/** Destino do clique na notificação (URL relativa; resolvida no service worker). */
export function urlDeDestino(targetType?: string, targetId?: string, metadata?: Record<string, unknown>): string {
  switch (targetType) {
    case 'mural': return '/?aba=mural';
    case 'evento': return '/?aba=graduacao';
    case 'justificativa': return '/?aba=justificativas';
    case 'graduacao': return '/?aba=graduacao';
    case 'vinculo': return '/?aba=conta';
    case 'presenca': return '/?aba=presenca';
    default: return metadata?.url as string || '/';
  }
}

/* ── Destinatários por contexto ──────────────────────────────────────────── */

/**
 * Contas destinatárias de um aluno: o próprio (se tiver conta) + responsáveis
 * com vínculo ACTIVE. Tutelado sem conta não gera destinatário próprio.
 */
export async function contasDoAlunoEResponsaveis(studentId: string): Promise<string[]> {
  const ids = new Set<string>();
  const { data: aluno } = await supabase.from('students').select('id').eq('id', studentId).maybeSingle();
  if (aluno) ids.add(aluno.id);
  const { data: links } = await supabase
    .from('guardian_links')
    .select('guardian_student_id')
    .eq('student_id', studentId)
    .eq('status', 'active');
  for (const l of links || []) ids.add(l.guardian_student_id);
  // Somente IDs que realmente são contas (linha em config/aluno-auth) — evita
  // notificar student_id de perfil sem login.
  const lista = Array.from(ids);
  if (lista.length === 0) return [];
  try {
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrl('config/aluno-auth.json', 30);
    if (urlData?.signedUrl) {
      const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
      if (res.ok) {
        const map = (await res.json()) as Record<string, { active?: boolean }>;
        return lista.filter(id => map[id]?.active);
      }
    }
  } catch { /* sem mapa: mantém a lista (o filtro de preferências segue valendo) */ }
  return lista;
}

/** IDs de contas com login de um conjunto de alunos (batch). */
export async function filtrarContasAtivas(studentIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (studentIds.length === 0) return out;
  try {
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrl('config/aluno-auth.json', 30);
    if (urlData?.signedUrl) {
      const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
      if (res.ok) {
        const map = (await res.json()) as Record<string, { active?: boolean }>;
        for (const id of studentIds) if (map[id]?.active) out.add(id);
        return out;
      }
    }
  } catch { /* segue */ }
  return new Set(studentIds);
}

/* ── Auditório ──────────────────────────────────────────────────────────── */

export async function appendNotificationAudit(userId: string, action: string, details?: Record<string, unknown>): Promise<void> {
  try {
    const { appendAudit } = await import('@/lib/audit');
    await appendAudit({
      actor: `conta:${userId.slice(0, 8)}`,
      actor_type: 'student',
      action: `push_${action}`,
      details: details || {},
    });
  } catch { /* auditoria nunca bloqueia */ }
}

/** Assinatura HMAC para URLs assinadas de teste (vapid key check). */
export function assinarPayloadAdmin(value: string): string {
  const secret = process.env.PA_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'portal-aluno-dev-secret';
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}
