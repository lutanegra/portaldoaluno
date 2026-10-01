import { createClient } from '@supabase/supabase-js';
import { gzipSync, gunzipSync } from 'zlib';
import { appendAudit } from '@/lib/audit';

/**
 * BACKUP COMPLETO DO SISTEMA (camada separada do CSV de alunos).
 * - Snapshot único e autocontido: TODAS as tabelas do banco (students,
 *   presencas, checkins) + TODOS os arquivos de configuração/estado do bucket
 *   (chamadas, justificativas, mural, contas do painel, lixeira, auditoria…).
 * - Compactado com gzip e salvo no bucket privado "photos" (backups/sistema/).
 * - Agendamento no SERVIDOR: a própria aplicação verifica se o backup venceu
 *   (gatilhos em login do painel e leitura de configuração) e um cron externo
 *   pode chamar /api/admin/backup-cron a qualquer hora — nada de setInterval.
 * - Retenção configurável (quantidade e/ou dias), nunca rodando após falha.
 * - Restauração substitui o estado atual; antes disso um backup automático
 *   do estado atual é criado (volta segura).
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const DIR = 'backups/sistema';
const INDEX_KEY = `${DIR}/index.json`;
const SETTINGS_KEY = `${DIR}/settings.json`;
const LOCK_KEY = `${DIR}/.running`;

export type BackupTipo = 'automatico' | 'manual' | 'pre_operacao' | 'pre_restauracao';

export type BackupItem = {
  filename: string;
  created_at: string;
  tipo: BackupTipo;
  gatilho: string;
  status: 'concluido' | 'falhou';
  erro?: string;
  size_bytes: number;
  duracao_ms: number;
  contagens: Record<string, number>;
  por: string;
};

export type BackupSettings = {
  automatico: boolean;
  frequencia: '6h' | 'diario' | '3dias' | 'semanal';
  horario: string;          // HH:MM no fuso de Brasília (só para 'diario')
  manter: number;           // quantidade de backups mantidos
  manter_dias: number | null; // alternativa por período
  atualizado_em: string;
  atualizado_por: string;
};

export const BACKUP_SETTINGS_DEFAULT: BackupSettings = {
  automatico: true,
  frequencia: 'diario',
  horario: '03:00',
  manter: 30,
  manter_dias: null,
  atualizado_em: '',
  atualizado_por: 'padrão',
};

type Snapshot = {
  versao: 2;
  criado_em: string;
  banco: {
    students: Record<string, unknown>[];
    presencas: Record<string, unknown>[];
    checkins: Record<string, unknown>[];
    tenants: Record<string, unknown>[];
    system_config: Record<string, unknown>[];
    guardians?: Record<string, unknown>[];
    guardian_links?: Record<string, unknown>[];
    adolescent_authorizations?: Record<string, unknown>[];
  };
  arquivos: Record<string, unknown>; // chave no bucket → conteúdo JSON
};

/* ── Leitura paginada das tabelas ──────────────────────────────────────── */

async function fetchAll(table: string, order?: string): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  const all: Record<string, unknown>[] = [];
  let from = 0;
  while (true) {
    let q = supabaseAdmin.from(table).select('*').range(from, from + PAGE - 1);
    if (order) q = q.order(order, { ascending: true });
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/* ── Arquivos JSON de configuração/estado do bucket ────────────────────── */

/** Pastas cujos arquivos .json são retratados no snapshot. */
const CONFIG_DIRS = ['config', 'extras', 'chamadas'];
/** Subpastas conhecidas de `chamadas/` (uma por data) + o índice na raiz. */
const CHAMADA_SUBDIR_RE = /^\d{4}-\d{2}-\d{2}$/;

async function listJsonKeys(): Promise<string[]> {
  const keys: string[] = [];
  for (const dir of CONFIG_DIRS) {
    try {
      const { data: folders } = await supabaseAdmin.storage.from(BUCKET).list(dir, { limit: 500 });
      for (const f of folders || []) {
        if ((f.name || '').endsWith('.json')) {
          keys.push(`${dir}/${f.name}`);
        } else if (dir !== 'chamadas' || CHAMADA_SUBDIR_RE.test(f.name)) {
          // config/ e extras/ têm subpastas próprias; em chamadas/, só as pastas
          // de data (AAAA-MM-DD) para não varrer lixo antigo.
          try {
            const { data: files } = await supabaseAdmin.storage.from(BUCKET).list(`${dir}/${f.name}`, { limit: 500 });
            for (const g of files || []) {
              if ((g.name || '').endsWith('.json')) keys.push(`${dir}/${f.name}/${g.name}`);
            }
          } catch { /* não é pasta */ }
        }
      }
    } catch { /* pasta ausente */ }
  }
  return keys.sort();
}

async function readJsonFile(key: string): Promise<unknown> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(key, 30);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function writeJsonFile(key: string, value: unknown): Promise<void> {
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(key, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw new Error(`${key}: ${error.message}`);
}

/* ── Índice, configurações e lock ──────────────────────────────────────── */

async function readIndex(): Promise<BackupItem[]> {
  const raw = await readJsonFile(INDEX_KEY);
  return Array.isArray(raw) ? (raw as BackupItem[]) : [];
}

async function writeIndex(items: BackupItem[]): Promise<void> {
  await writeJsonFile(INDEX_KEY, items);
}

let settingsCache: { at: number; val: BackupSettings } | null = null;

export function invalidateBackupSettingsCache(): void {
  settingsCache = null;
}

export async function loadSettings(): Promise<BackupSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.val;
  const raw = (await readJsonFile(SETTINGS_KEY)) as Partial<BackupSettings> | null;
  const val: BackupSettings = { ...BACKUP_SETTINGS_DEFAULT, ...(raw || {}) };
  settingsCache = { at: Date.now(), val };
  return val;
}

export async function saveSettings(patch: Partial<BackupSettings>, actor: string): Promise<BackupSettings> {
  const cur = await loadSettings();
  const next: BackupSettings = {
    ...cur,
    ...patch,
    horario: /^\d{1,2}:\d{2}$/.test(String(patch.horario || cur.horario)) ? String(patch.horario || cur.horario).padStart(5, '0') : cur.horario,
    manter: Math.min(500, Math.max(3, Number(patch.manter ?? cur.manter) || cur.manter)),
    manter_dias: patch.manter_dias === null ? null : (Number(patch.manter_dias ?? cur.manter_dias) || null),
    atualizado_em: new Date().toISOString(),
    atualizado_por: actor || cur.atualizado_por,
  };
  await writeJsonFile(SETTINGS_KEY, next);
  invalidateBackupSettingsCache();
  await appendAudit({ actor: actor || 'sistema', actor_type: 'admin', action: 'backup_config_atualizada', details: next as unknown as Record<string, unknown> });
  return next;
}

async function acquireLock(): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).list(DIR, { limit: 100, search: '.running' });
    const running = (data || []).find(f => f.name === '.running');
    if (running) {
      // Lock órfão (processo morreu): expira em 5 minutos
      if (Date.now() - new Date(running.created_at || 0).getTime() < 5 * 60_000) return false;
      await supabaseAdmin.storage.from(BUCKET).remove([LOCK_KEY]).catch(() => {});
    }
    const blob = new Blob([JSON.stringify({ inicio: new Date().toISOString() })], { type: 'application/json' });
    await supabaseAdmin.storage.from(BUCKET).upload(LOCK_KEY, blob, { upsert: false });
    return true;
  } catch { return true; } // sem lock, segue mesmo assim (melhor esforço)
}

async function releaseLock(): Promise<void> {
  try { await supabaseAdmin.storage.from(BUCKET).remove([LOCK_KEY]); } catch { /* ok */ }
}

/* ── Agendamento (fuso de Brasília para o horário diário) ──────────────── */

function nextRunAt(settings: BackupSettings, lastSuccessfulIso: string | null): number {
  if (!settings.automatico) return Number.POSITIVE_INFINITY;
  const now = Date.now();
  if (!lastSuccessfulIso) return now; // primeira execução: o quanto antes
  const last = new Date(lastSuccessfulIso).getTime();
  switch (settings.frequencia) {
    case '6h': return last + 6 * 3600_000;
    case '3dias': return last + 72 * 3600_000;
    case 'semanal': return last + 7 * 24 * 3600_000;
    case 'diario':
    default: {
      const [h, m] = (settings.horario || '03:00').split(':').map(Number);
      const agoraSP = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
      const alvoSP = new Date(agoraSP);
      alvoSP.setHours(h || 0, m || 0, 0, 0);
      const alvoUtc = alvoSP.getTime() + (now - agoraSP.getTime());
      return alvoUtc > last ? alvoUtc : alvoUtc + 24 * 3600_000;
    }
  }
}

/* ── Geração do snapshot ───────────────────────────────────────────────── */

async function buildSnapshot(): Promise<{ snapshot: Snapshot; contagens: Record<string, number> }> {
  const [students, presencas, checkins, tenants, systemConfig, guardians, guardianLinks, adolescentAuths] = await Promise.all([
    fetchAll('students', 'ordem_inscricao'),
    fetchAll('presencas', 'data_treino'),
    fetchAll('checkins', 'data'),
    fetchAll('tenants', 'id'),
    fetchAll('system_config', 'id'),
    fetchAll('guardians', 'student_id'),
    fetchAll('guardian_links', 'created_at'),
    fetchAll('adolescent_authorizations', 'created_at'),
  ]);
  const keys = await listJsonKeys();
  const arquivos: Record<string, unknown> = {};
  for (const key of keys) {
    const content = await readJsonFile(key);
    if (content !== null) arquivos[key] = content;
  }
  const contagens: Record<string, number> = {
    students: students.length,
    presencas: presencas.length,
    checkins: checkins.length,
    nucleos: tenants.length,
    configuracoes: systemConfig.length,
    responsaveis: guardians.length,
    vinculos: guardianLinks.length,
    autorizacoes: adolescentAuths.length,
    arquivos: keys.length,
  };
  return {
    snapshot: {
      versao: 2,
      criado_em: new Date().toISOString(),
      banco: {
        students, presencas, checkins, tenants, system_config: systemConfig,
        guardians, guardian_links: guardianLinks, adolescent_authorizations: adolescentAuths,
      },
      arquivos,
    },
    contagens,
  };
}

async function uploadBackup(filename: string, snapshot: Snapshot): Promise<number> {
  const json = JSON.stringify(snapshot);
  const gz = gzipSync(Buffer.from(json, 'utf8'), { level: 6 });
  const blob = new Blob([new Uint8Array(gz)], { type: 'application/gzip' });
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(filename, blob, {
    upsert: false, contentType: 'application/gzip',
  });
  if (error && !/exist|duplicate/i.test(error.message || '')) throw new Error(error.message);
  if (error) {
    const retry = await supabaseAdmin.storage.from(BUCKET).upload(filename, blob, { upsert: true, contentType: 'application/gzip' });
    if (retry.error) throw new Error(retry.error.message);
  }
  return gz.byteLength;
}

/* ── Retenção ──────────────────────────────────────────────────────────── */

/** Nunca roda após falha; mantém no mínimo as 5 cópias de sucesso mais recentes. */
async function applyRetention(items: BackupItem[], settings: BackupSettings): Promise<BackupItem[]> {
  const ok = items.filter(i => i.status === 'concluido');
  const falhas = items.filter(i => i.status !== 'concluido');

  let mantidos: BackupItem[];
  if (settings.manter_dias && settings.manter_dias > 0) {
    const corte = Date.now() - settings.manter_dias * 24 * 3600_000;
    const naJanela = ok.filter(i => new Date(i.created_at).getTime() >= corte);
    mantidos = naJanela.length >= 5 ? naJanela : ok.slice(0, Math.max(5, naJanela.length));
  } else {
    mantidos = ok.slice(0, Math.max(3, settings.manter));
  }

  // Falhas antigas (7 dias) saem do histórico
  const falhasMantidas = falhas.filter(i => Date.now() - new Date(i.created_at).getTime() < 7 * 24 * 3600_000);

  const novo = [...mantidos, ...falhasMantidas].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const remover = items.filter(i => !novo.some(n => n.filename === i.filename)).map(i => i.filename);
  if (remover.length) {
    try { await supabaseAdmin.storage.from(BUCKET).remove(remover); } catch { /* melhor esforço */ }
  }
  await writeIndex(novo);
  return novo;
}

/* ── Execução do backup ────────────────────────────────────────────────── */

export async function runBackupSistema(opts: {
  tipo: BackupTipo;
  gatilho: string;
  actor: string;
  skipLock?: boolean;
}): Promise<{ ok: true; item: BackupItem } | { ok: false; error: string }> {
  const inicio = Date.now();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '');
  const filename = `${DIR}/full-${dateStr}-${timeStr}-${opts.tipo}.json.gz`;

  let gotLock = true;
  if (!opts.skipLock) gotLock = await acquireLock();
  if (!gotLock) return { ok: false, error: 'Outro backup já está em execução.' };

  try {
    const { snapshot, contagens } = await buildSnapshot();
    const size = await uploadBackup(filename, snapshot);
    const item: BackupItem = {
      filename,
      created_at: now.toISOString(),
      tipo: opts.tipo,
      gatilho: opts.gatilho,
      status: 'concluido',
      size_bytes: size,
      duracao_ms: Date.now() - inicio,
      contagens,
      por: opts.actor || 'sistema',
    };
    const items = await readIndex();
    const idx = items.findIndex(i => i.filename === filename);
    if (idx >= 0) items[idx] = item; else items.unshift(item);
    const settings = await loadSettings();
    await applyRetention(items, settings); // só roda quando concluído
    await appendAudit({
      actor: opts.actor || 'sistema',
      actor_type: opts.actor ? 'admin' : 'system',
      action: 'backup_sistema_gerado',
      details: { arquivo: filename, tipo: opts.tipo, gatilho: opts.gatilho, tamanho: size, duracao_ms: item.duracao_ms, contagens },
    });
    return { ok: true, item };
  } catch (err) {
    const erro = String((err as Error)?.message || err);
    const item: BackupItem = {
      filename,
      created_at: now.toISOString(),
      tipo: opts.tipo,
      gatilho: opts.gatilho,
      status: 'falhou',
      erro,
      size_bytes: 0,
      duracao_ms: Date.now() - inicio,
      contagens: {},
      por: opts.actor || 'sistema',
    };
    const items = await readIndex();
    items.unshift(item);
    await writeIndex(items.slice(0, 200)); // falha nunca dispara retenção
    await appendAudit({ actor: opts.actor || 'sistema', actor_type: 'system', action: 'backup_sistema_falhou', details: { erro, gatilho: opts.gatilho } });
    return { ok: false, error: erro };
  } finally {
    if (!opts.skipLock) await releaseLock();
  }
}

/** Verifica vencimento e roda o backup automático (servidor). */
export async function runDueBackupIfNeeded(forcar = false): Promise<{ rodou: boolean; motivo: string }> {
  const settings = await loadSettings();
  if (!settings.automatico && !forcar) return { rodou: false, motivo: 'automático desativado' };
  const items = await readIndex();
  const ultimoOk = items.find(i => i.status === 'concluido') || null;
  const proximo = nextRunAt(settings, ultimoOk?.created_at ?? null);
  if (!forcar && Date.now() < proximo) return { rodou: false, motivo: 'ainda não venceu' };
  const r = await runBackupSistema({ tipo: 'automatico', gatilho: 'agendado', actor: '' });
  return r.ok ? { rodou: true, motivo: 'backup criado' } : { rodou: false, motivo: `falhou: ${r.error}` };
}

/** Backup de segurança ANTES de operações críticas — nunca bloqueia o fluxo. */
export async function backupPreOperacao(actor: string, gatilho: string): Promise<void> {
  try {
    const r = await runBackupSistema({ tipo: 'pre_operacao', gatilho, actor });
    if (!r.ok) {
      await appendAudit({ actor, actor_type: 'admin', action: 'backup_pre_operacao_falhou', details: { gatilho, erro: r.error } });
    }
  } catch { /* nunca bloqueia a operação principal */ }
}

/* ── Consulta de status para a UI ──────────────────────────────────────── */

export async function getBackupStatus(): Promise<{
  settings: BackupSettings;
  items: BackupItem[];
  ultimo: BackupItem | null;
  ultimoAutomatico: BackupItem | null;
  proximo: number | null;
}> {
  const [settings, items] = await Promise.all([loadSettings(), readIndex()]);
  const ultimo = items.find(i => i.status === 'concluido') || null;
  const ultimoAutomatico = items.find(i => i.status === 'concluido' && i.tipo === 'automatico') || null;
  const proximo = settings.automatico ? nextRunAt(settings, ultimo?.created_at ?? null) : null;
  return { settings, items: items.slice(0, 80), ultimo, ultimoAutomatico, proximo };
}

/* ── Download ──────────────────────────────────────────────────────────── */

export function isValidBackupFilename(filename: string): boolean {
  return filename.startsWith(`${DIR}/`) && filename.endsWith('.json.gz') && !filename.includes('..');
}

export async function getBackupDownloadUrl(filename: string): Promise<string> {
  if (!isValidBackupFilename(filename)) throw new Error('Arquivo inválido.');
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(filename, 120);
  if (error || !data?.signedUrl) throw new Error('Não foi possível gerar o link de download.');
  return data.signedUrl;
}

export async function deleteBackup(filename: string, actor: string): Promise<void> {
  if (!isValidBackupFilename(filename)) throw new Error('Arquivo inválido.');
  const items = await readIndex();
  const alvo = items.find(i => i.filename === filename);
  // Proteção: nunca apagar a única cópia bem-sucedida existente
  const outrosOk = items.filter(i => i.status === 'concluido' && i.filename !== filename);
  if (alvo?.status === 'concluido' && outrosOk.length === 0) {
    throw new Error('Esta é a única cópia válida — gere outra antes de removê-la.');
  }
  await supabaseAdmin.storage.from(BUCKET).remove([filename]);
  await writeIndex(items.filter(i => i.filename !== filename));
  await appendAudit({ actor: actor || 'painel', actor_type: 'admin', action: 'backup_sistema_removido', details: { arquivo: filename } });
}

/* ── Restauração (substitui o estado atual pelo do snapshot) ───────────── */

async function upsertTable(table: string, rows: Record<string, unknown>[]): Promise<number> {
  for (let i = 0; i < rows.length; i += 400) {
    const { error } = await supabaseAdmin.from(table).upsert(rows.slice(i, i + 400), { onConflict: 'id' });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  return rows.length;
}

async function deleteNotIn(table: string, snapshotIds: Set<string>): Promise<number> {
  const atuais = await fetchAll(table);
  const remover = atuais.map(r => String(r.id)).filter(id => !snapshotIds.has(id));
  for (let i = 0; i < remover.length; i += 100) {
    const { error } = await supabaseAdmin.from(table).delete().in('id', remover.slice(i, i + 100));
    if (error) throw new Error(`${table} (remoção): ${error.message}`);
  }
  return remover.length;
}

export async function restoreBackupSistema(filename: string, actor: string): Promise<{
  restaurados: Record<string, number>;
  removidos: Record<string, number>;
  arquivos: number;
}> {
  if (!isValidBackupFilename(filename)) throw new Error('Arquivo inválido.');
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(filename);
  if (error || !data) throw new Error('Não foi possível ler a cópia selecionada.');
  let snapshot: Snapshot;
  try {
    const buf = Buffer.from(new Uint8Array(await data.arrayBuffer()));
    snapshot = JSON.parse(gunzipSync(buf).toString('utf8')) as Snapshot;
  } catch {
    throw new Error('A cópia está corrompida ou ilegível.');
  }
  if (!snapshot?.banco || !Array.isArray(snapshot.banco.students)) throw new Error('Formato de backup desconhecido.');

  const restaurados: Record<string, number> = {};
  const removidos: Record<string, number> = {};

  // Banco — students primeiro (presenças dependem deles via FK), depois as
  // derivadas, e por fim remoção de registros que não existiam no snapshot.
  const temTenants = Array.isArray(snapshot.banco.tenants);
  if (temTenants) restaurados.tenants = await upsertTable('tenants', snapshot.banco.tenants);
  restaurados.students = await upsertTable('students', snapshot.banco.students);
  restaurados.presencas = await upsertTable('presencas', snapshot.banco.presencas);
  restaurados.checkins = await upsertTable('checkins', snapshot.banco.checkins);
  if (Array.isArray(snapshot.banco.system_config)) {
    restaurados.configuracoes = await upsertTable('system_config', snapshot.banco.system_config);
  }
  // Responsáveis/vínculos/autorizações (backups antigos simplesmente não trazem)
  if (Array.isArray(snapshot.banco.guardians)) {
    restaurados.responsaveis = await upsertTable('guardians', snapshot.banco.guardians);
  }
  if (Array.isArray(snapshot.banco.guardian_links)) {
    restaurados.vinculos = await upsertTable('guardian_links', snapshot.banco.guardian_links);
  }
  if (Array.isArray(snapshot.banco.adolescent_authorizations)) {
    restaurados.autorizacoes = await upsertTable('adolescent_authorizations', snapshot.banco.adolescent_authorizations);
  }

  const idsStudents = new Set(snapshot.banco.students.map(r => String(r.id)));
  const idsPresencas = new Set(snapshot.banco.presencas.map(r => String(r.id)));
  const idsCheckins = new Set(snapshot.banco.checkins.map(r => String(r.id)));
  // Derivadas primeiro (FK para students), depois students
  if (Array.isArray(snapshot.banco.adolescent_authorizations)) {
    removidos.autorizacoes = await deleteNotIn('adolescent_authorizations', new Set(snapshot.banco.adolescent_authorizations.map(r => String(r.id))));
  }
  if (Array.isArray(snapshot.banco.guardian_links)) {
    removidos.vinculos = await deleteNotIn('guardian_links', new Set(snapshot.banco.guardian_links.map(r => String(r.id))));
  }
  if (Array.isArray(snapshot.banco.guardians)) {
    removidos.responsaveis = await deleteNotIn('guardians', new Set(snapshot.banco.guardians.map(r => String(r.id))));
  }
  removidos.checkins = await deleteNotIn('checkins', idsCheckins);
  removidos.presencas = await deleteNotIn('presencas', idsPresencas);
  removidos.students = await deleteNotIn('students', idsStudents);

  // Arquivos de configuração — sobrescreve com o conteúdo do snapshot
  let arquivos = 0;
  for (const [key, value] of Object.entries(snapshot.arquivos || {})) {
    try { await writeJsonFile(key, value); arquivos++; } catch { /* segue */ }
  }

  await appendAudit({
    actor,
    actor_type: 'admin',
    action: 'backup_sistema_restaurado',
    details: { arquivo: filename, restaurados, removidos, arquivos },
  });

  return { restaurados, removidos, arquivos };
}
