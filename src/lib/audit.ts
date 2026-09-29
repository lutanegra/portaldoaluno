import { createClient } from '@supabase/supabase-js';

/**
 * Auditoria centralizada do sistema.
 * Cada entrada vai também para /api/admin/logs, para aparecer na aba Auditoria do painel.
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const KEY = 'config/audit_logs.json';
const MAX_LOGS = 2000;

export type AuditEntry = {
  id: string;
  timestamp: string;
  actor: string;
  actor_type: 'admin' | 'student' | 'system';
  action: string;
  target_id?: string;
  target_name?: string;
  details?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
};

async function loadLogs(): Promise<AuditEntry[]> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(KEY, 30);
    if (!data?.signedUrl) return [];
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

export async function appendAudit(entry: {
  actor: string;
  actor_type?: 'admin' | 'student' | 'system';
  action: string;
  target_id?: string;
  target_name?: string;
  details?: Record<string, unknown>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
}): Promise<void> {
  const full: AuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    actor: entry.actor || 'unknown',
    actor_type: entry.actor_type || 'system',
    action: entry.action,
    target_id: entry.target_id,
    target_name: entry.target_name,
    details: entry.details,
    before: entry.before,
    after: entry.after,
    ip: entry.ip,
  };

  try {
    const logs = await loadLogs();
    logs.unshift(full);
    const trimmed = logs.slice(0, MAX_LOGS);
    const blob = new Blob([JSON.stringify(trimmed)], { type: 'application/json' });
    await supabaseAdmin.storage.from(BUCKET).upload(KEY, blob, { upsert: true, contentType: 'application/json' });
  } catch { /* não bloqueia a operação principal */ }
}
