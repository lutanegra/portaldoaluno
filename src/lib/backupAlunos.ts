import { createClient } from '@supabase/supabase-js';
import { appendAudit } from '@/lib/audit';
import { getTenantId } from '@/lib/tenants';

/**
 * Backup automático dos alunos.
 * - Gera o MESMO CSV canônico do botão "Exportar CSV Completo".
 * - Guarda no bucket privado "photos", pasta backups/.
 * - Mantém cópia estável (alunos-latest.csv) + histórico rotativo (30 cópias)
 *   indexado em backups/index.json.
 * - A restauração reaproveita a mesma lógica de upsert da importação manual.
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const DIR = 'backups';
const LATEST_KEY = `${DIR}/alunos-latest.csv`;
const INDEX_KEY = `${DIR}/index.json`;
const KEEP = 30;

export type BackupIndexItem = {
  filename: string;
  created_at: string;
  total_alunos: number;
  size_bytes: number;
  por: string;
};

export type BackupInfo = {
  latest: BackupIndexItem | null;
  history: BackupIndexItem[];
};

export type ImportResult = {
  success: true;
  updated: number;
  skipped: number;
  notFound: number;
  total: number;
  errors: string[];
};

/* ── Leitura dos alunos (paginada, igual à exportação manual) ─────────── */

export async function fetchStudentsRaw(): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const all: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from('students')
      .select('*')
      .order('ordem_inscricao', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/* ── Geração do CSV canônico (mesmas colunas da exportação manual) ────── */

const COLUMNS = [
  'id', 'ordem_inscricao', 'created_at',
  'nome_completo', 'apelido', 'nome_social', 'sexo',
  'cpf', 'identidade', 'data_nascimento', 'telefone', 'email',
  'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado',
  'graduacao', 'tipo_graduacao', 'nucleo', 'tenant_id', 'foto_url',
  'nome_pai', 'nome_mae',
  'autoriza_imagem', 'menor_de_idade',
  'nome_responsavel', 'cpf_responsavel', 'assinatura_responsavel',
  'assinatura_pai', 'assinatura_mae',
  'password',
];

const DATE_COLS = new Set(['data_nascimento', 'created_at']);
const BOOL_COLS = new Set(['autoriza_imagem', 'menor_de_idade', 'assinatura_responsavel', 'assinatura_pai', 'assinatura_mae']);
const NAME_COLS = new Set(['nome_completo']);

function escape(v: unknown): string {
  const s = (v ?? '').toString().trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDate(d: unknown): string {
  if (!d) return '';
  const day = String(d).split('T')[0];
  if (day === '1900-01-01' || day === '0001-01-01') return '';
  const year = parseInt(day.slice(0, 4), 10);
  if (isNaN(year) || year < 2000) return '';
  return day;
}

function formatBool(v: unknown): string {
  if (v === true || v === 'true') return 'Sim';
  if (v === false || v === 'false') return 'Não';
  return '';
}

function cleanName(n: unknown): string {
  return String(n ?? '').replace(/^\*+/, '').trim();
}

export function buildStudentsCsv(allStudents: Record<string, unknown>[]): string {
  const rows = allStudents.map(s =>
    COLUMNS.map(col => {
      const v = s[col];
      if (NAME_COLS.has(col)) return escape(cleanName(v));
      if (DATE_COLS.has(col)) return escape(formatDate(v));
      if (BOOL_COLS.has(col)) return escape(formatBool(v));
      return escape(v);
    }).join(',')
  );
  return [COLUMNS.join(','), ...rows].join('\r\n');
}

/* ── Storage helpers ───────────────────────────────────────────────────── */

async function readIndex(): Promise<BackupIndexItem[]> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(INDEX_KEY, 30);
    if (!data?.signedUrl) return [];
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? (list as BackupIndexItem[]) : [];
  } catch { return []; }
}

async function writeIndex(items: BackupIndexItem[]): Promise<void> {
  const blob = new Blob([JSON.stringify(items)], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(INDEX_KEY, blob, { upsert: true, contentType: 'application/json' });
}

export async function getBackupInfo(): Promise<BackupInfo> {
  const history = await readIndex();
  return { latest: history[0] ?? null, history };
}

/* ── Geração do backup ─────────────────────────────────────────────────── */

export async function runBackupAlunos(actor: string): Promise<{ ok: true; item: BackupIndexItem } | { ok: false; error: string }> {
  try {
    const students = await fetchStudentsRaw();
    const csv = buildStudentsCsv(students);
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
    const filename = `${DIR}/alunos-${dateStr}-${timeStr}.csv`;

    const csvBlob = new Blob([csv], { type: 'text/csv; charset=utf-8' });
    const { error: upErr } = await supabaseAdmin.storage.from(BUCKET).upload(filename, csvBlob, {
      upsert: false, contentType: 'text/csv; charset=utf-8',
    });
    // Reexecução no mesmo segundo: sobrescreve em vez de falhar
    if (upErr && !String(upErr.message || '').toLowerCase().match(/exist|duplicate/)) {
      throw new Error(upErr.message);
    }
    await supabaseAdmin.storage.from(BUCKET).upload(LATEST_KEY, csvBlob, { upsert: true, contentType: 'text/csv; charset=utf-8' });

    const item: BackupIndexItem = {
      filename,
      created_at: now.toISOString(),
      total_alunos: students.length,
      size_bytes: csvBlob.size,
      por: actor || 'sistema',
    };
    const old = await readIndex();
    const history = [item, ...old.filter(i => i.filename !== filename)].slice(0, KEEP);
    await writeIndex(history);

    // Remove cópias antigas fora da janela de retenção
    const valid = new Set(history.map(i => i.filename));
    const stale = old.map(i => i.filename).filter(f => !valid.has(f));
    if (stale.length) {
      try { await supabaseAdmin.storage.from(BUCKET).remove(stale); } catch { /* melhor esforço */ }
    }

    await appendAudit({
      actor: actor || 'sistema',
      actor_type: actor === 'sistema' ? 'system' : 'admin',
      action: 'backup_alunos_gerado',
      details: { arquivo: filename, total_alunos: students.length, tamanho: csvBlob.size },
    });

    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

/** Backup automático pós-mudança: nunca derruba a operação principal. */
export async function autoBackupAfterChange(actor: string, acao: string): Promise<void> {
  try {
    const r = await runBackupAlunos(actor);
    if (!r.ok) {
      await appendAudit({
        actor: actor || 'sistema',
        actor_type: 'system',
        action: 'backup_alunos_falhou',
        details: { acao, erro: r.error },
      });
    }
  } catch { /* backup nunca bloqueia a operação principal */ }
}

/* ── Restauração (mesma lógica da importação manual) ───────────────────── */

export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const rows = lines.slice(1).map(line => {
    const vals: string[] = [];
    let cur = ''; let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += ch; }
    }
    vals.push(cur.trim());
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { if (h) obj[h] = (vals[i] || '').replace(/^"|"$/g, ''); });
    return obj;
  }).filter(r => r.nome_completo || r.nome);
  return rows;
}

async function latestCsvText(): Promise<string> {
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(LATEST_KEY, 30);
  if (!data?.signedUrl) throw new Error('Nenhum backup encontrado.');
  const res = await fetch(data.signedUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error('Não foi possível ler o backup mais recente.');
  return res.text();
}

const normalize = (s: string) =>
  (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function applyStudentRows(rows: Record<string, string>[]): Promise<ImportResult> {
  const { data: students, error: fetchErr } = await supabaseAdmin
    .from('students')
    .select('id, nome_completo, cpf');
  if (fetchErr) throw new Error(fetchErr.message);

  const nameMap: Record<string, string> = {};
  const cpfMap: Record<string, string> = {};
  for (const s of (students || [])) {
    nameMap[normalize(s.nome_completo || '')] = s.id;
    if (s.cpf) cpfMap[s.cpf.replace(/\D/g, '')] = s.id;
  }

  let updated = 0, skipped = 0, notFound = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const cpfRaw = (row.cpf || '').replace(/\D/g, '');
    let studentId = cpfRaw.length === 11 ? cpfMap[cpfRaw] : undefined;
    if (!studentId) studentId = nameMap[normalize(row.nome_completo || row.nome || '')];
    if (!studentId) { notFound++; continue; }

    const str = (v: string | undefined) => v?.trim() || null;
    const bool = (v: string | undefined) => {
      if (!v) return undefined;
      return ['true', 'sim', '1', 'yes'].includes(v.trim().toLowerCase());
    };

    const patch: Record<string, unknown> = {};

    if (str(row.cpf))              patch.cpf              = str(row.cpf);
    if (str(row.identidade))       patch.identidade       = str(row.identidade);
    if (str(row.email))            patch.email            = str(row.email);
    if (str(row.telefone))         patch.telefone         = str(row.telefone);
    if (str(row.data_nascimento))  patch.data_nascimento  = str(row.data_nascimento);
    if (str(row.nucleo))           { patch.nucleo = str(row.nucleo); patch.tenant_id = getTenantId(row.nucleo.trim()); }
    if (str(row.graduacao))        patch.graduacao        = str(row.graduacao);
    if (str(row.tipo_graduacao))   patch.tipo_graduacao   = str(row.tipo_graduacao);
    if (str(row.cep))              patch.cep              = str(row.cep);
    if (str(row.endereco))         patch.endereco         = str(row.endereco);
    if (str(row.numero))           patch.numero           = str(row.numero);
    if (str(row.complemento))      patch.complemento      = str(row.complemento);
    if (str(row.bairro))           patch.bairro           = str(row.bairro);
    if (str(row.cidade))           patch.cidade           = str(row.cidade);
    if (str(row.estado))           patch.estado           = str(row.estado);
    if (str(row.nome_pai))         patch.nome_pai         = str(row.nome_pai);
    if (str(row.nome_mae))         patch.nome_mae         = str(row.nome_mae);
    if (str(row.nome_responsavel)) patch.nome_responsavel = str(row.nome_responsavel);
    if (str(row.cpf_responsavel))  patch.cpf_responsavel  = str(row.cpf_responsavel);
    if (str(row.apelido))          patch.apelido          = str(row.apelido);
    if (str(row.nome_social))      patch.nome_social      = str(row.nome_social);
    if (str(row.sexo))             patch.sexo             = str(row.sexo);

    const menorVal = bool(row.menor_de_idade);
    if (menorVal !== undefined) patch.menor_de_idade = menorVal;

    // Auto-compute menor_de_idade from data_nascimento
    if (patch.menor_de_idade === undefined && patch.data_nascimento) {
      try {
        const dob = new Date(String(patch.data_nascimento) + 'T12:00:00');
        const today = new Date();
        const age = today.getFullYear() - dob.getFullYear() -
          (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
        patch.menor_de_idade = age < 18;
      } catch { /* skip */ }
    }

    // Auto-set tipo_graduacao if missing
    if (!patch.tipo_graduacao && patch.nucleo) {
      patch.tipo_graduacao = patch.menor_de_idade ? 'infantil' : 'adulta';
    }

    if (!Object.keys(patch).length) { skipped++; continue; }

    const { error } = await supabaseAdmin.from('students').update(patch).eq('id', studentId);
    if (error) {
      errors.push(`${row.nome_completo || row.nome}: ${error.message}`);
      skipped++;
    } else {
      updated++;
    }
  }

  return { success: true, updated, skipped, notFound, total: rows.length, errors: errors.slice(0, 20) };
}

export async function restoreFromLatestBackup(): Promise<ImportResult> {
  const text = await latestCsvText();
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('O backup mais recente está vazio ou ilegível.');
  return applyStudentRows(rows);
}
