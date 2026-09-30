import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appendAudit } from '@/lib/audit';
import { requirePanelAdmin } from '@/lib/adminGuard';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const KEY = 'config/admin_logs.json';
const MAX_LOGS = 500;
const RETURN_LIMIT = 200;

export interface AdminLogEntry {
  id: string;
  action: string;
  user: string;
  nucleo: string;
  timestamp: string;
  details?: string;
}

async function readLogs(): Promise<AdminLogEntry[]> {
  try {
    const { data: urlData } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(KEY, 10);
    if (!urlData?.signedUrl) return [];
    const res = await fetch(urlData.signedUrl, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

async function saveLogs(logs: AdminLogEntry[]): Promise<void> {
  const blob = new Blob([JSON.stringify(logs)], { type: 'application/json' });
  await supabaseAdmin.storage
    .from(BUCKET)
    .upload(KEY, blob, { upsert: true, contentType: 'application/json' });
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function GET(req: Request) {
  const __g = requirePanelAdmin(req);
  if (!__g.ok) return __g.res;
  const logs = await readLogs();
  // Une com a auditoria estruturada (src/lib/audit.ts) para exibição unificada
  let auditEntries: AdminLogEntry[] = [];
  try {
    const { data } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl('config/audit_logs.json', 10);
    if (data?.signedUrl) {
      const res = await fetch(data.signedUrl, { cache: 'no-store' });
      if (res.ok) {
        const raw: Array<{ timestamp: string; actor: string; action: string; target_name?: string; details?: Record<string, unknown> }> = await res.json();
        auditEntries = raw.map(e => ({
          id: `audit_${e.timestamp}_${Math.random().toString(36).slice(2, 8)}`,
          action: e.action,
          user: e.actor,
          nucleo: typeof e.details?.nucleo === 'string' ? e.details.nucleo : '—',
          timestamp: e.timestamp,
          details: e.target_name ? `${e.target_name}${e.details ? ` · ${JSON.stringify(e.details).slice(0, 200)}` : ''}` : e.details ? JSON.stringify(e.details).slice(0, 240) : undefined,
        }));
      }
    }
  } catch { /* segue só com os logs antigos */ }
  const all = [...logs, ...auditEntries];
  // Return most recent first, capped at RETURN_LIMIT
  const sorted = [...all].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  return NextResponse.json(sorted.slice(0, RETURN_LIMIT));
}

export async function POST(req: NextRequest) {
  const __g = requirePanelAdmin(req);
  if (!__g.ok) return __g.res;

  const body: Partial<AdminLogEntry> = await req.json();

  if (!body.action || !body.user || !body.nucleo) {
    return NextResponse.json(
      { error: 'action, user and nucleo are required' },
      { status: 400 },
    );
  }

  const entry: AdminLogEntry = {
    id: generateId(),
    action: body.action,
    user: body.user,
    nucleo: body.nucleo,
    timestamp: new Date().toISOString(),
    ...(body.details !== undefined ? { details: body.details } : {}),
  };

  // Auditoria estruturada paralela (fonte canônica em config/audit_logs.json)
  try {
    await appendAudit({
      actor: body.user,
      actor_type: 'admin',
      action: body.action,
      details: { nucleo: body.nucleo, detalhes: body.details },
    }).catch(() => {});
  } catch { /* best-effort */ }

  const logs = await readLogs();
  logs.push(entry);

  // Trim to MAX_LOGS keeping the most recent entries
  const trimmed =
    logs.length > MAX_LOGS
      ? logs
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
          .slice(logs.length - MAX_LOGS)
      : logs;

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(
      KEY,
      new Blob([JSON.stringify(trimmed)], { type: 'application/json' }),
      { upsert: true, contentType: 'application/json' },
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, entry });
}
