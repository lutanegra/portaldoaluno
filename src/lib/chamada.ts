/**
 * Chamada diária por núcleo — armazenamento no bucket privado `photos`,
 * chave `chamadas/{data}/{slug}.json` com índice de datas `chamadas/index.json`.
 *
 * Registros existentes em checkins/{data}/{studentId}.json (presenças avulsas
 * do aluno ou marcadas individualmente) continuam válidos: a chamada os
 * carrega como PRESENTE, e ao salvar a chamada o registro avulso é
 * sincronizado (removido se virou falta, mantido/atualizado se presente).
 */
import { createClient } from '@supabase/supabase-js';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

export const CHAMADA_BUCKET = 'photos';
export const CHAMADA_DIR = 'chamadas';

export type ChamadaStatus = 'P' | 'F' | 'JU';

export type ChamadaEntry = {
  /** id do aluno */
  id: string;
  /** status na chamada: P presente, F falta, JU falta justificada */
  st: ChamadaStatus;
  /** hora do registro HH:MM (America/Sao_Paulo) */
  h?: string;
  /** origem: chamada = salva pelo admin; checkin = auto do check-in do aluno */
  src?: 'chamada' | 'checkin';
  /** nome no momento do registro (conveniência para relatórios) */
  n?: string;
};

export type ChamadaDoc = {
  data: string;        // YYYY-MM-DD
  nucleo: string;      // slug do núcleo
  entries: ChamadaEntry[];
  updated_at: string;
  updated_by?: string;
};

/** Data de hoje em America/Sao_Paulo (YYYY-MM-DD). */
export function hojeBR(): string {
  const br = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return `${br.getFullYear()}-${String(br.getMonth() + 1).padStart(2, '0')}-${String(br.getDate()).padStart(2, '0')}`;
}

export function horaBR(): string {
  const br = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return br.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const chamadaKey = (data: string, nucleoSlug: string) => `${CHAMADA_DIR}/${data}/${nucleoSlug}.json`;

/** Carrega a chamada de uma data/núcleo (null se não existe). */
export async function loadChamada(data: string, nucleoSlug: string): Promise<ChamadaDoc | null> {
  try {
    const { data: urlData } = await admin.storage.from(CHAMADA_BUCKET).createSignedUrl(chamadaKey(data, nucleoSlug), 30);
    if (!urlData?.signedUrl) return null;
    const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const doc = await res.json() as ChamadaDoc;
    if (!doc || !Array.isArray(doc.entries)) return null;
    return doc;
  } catch {
    return null;
  }
}

/** Grava a chamada (upsert) e atualiza o índice de datas. */
export async function saveChamada(doc: ChamadaDoc): Promise<void> {
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const { error } = await admin.storage.from(CHAMADA_BUCKET).upload(chamadaKey(doc.data, doc.nucleo), blob, {
    contentType: 'application/json',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  await tocarIndice(idx => {
    const item = idx.find(i => i.data === doc.data && i.nucleo === doc.nucleo);
    if (item) {
      item.updated_at = doc.updated_at;
      item.total = doc.entries.length;
    } else {
      idx.push({ data: doc.data, nucleo: doc.nucleo, updated_at: doc.updated_at, total: doc.entries.length });
    }
    return idx;
  });
}

export type ChamadaIndexItem = { data: string; nucleo: string; updated_at: string; total: number };

/** Lê/atualiza `chamadas/index.json` de forma consistente (read-modify-write sequencial). */
let indexChain: Promise<unknown> = Promise.resolve();
export function tocarIndice(mutate: (idx: ChamadaIndexItem[]) => ChamadaIndexItem[]): Promise<void> {
  const task = indexChain.then(async () => {
    let idx: ChamadaIndexItem[] = [];
    try {
      const { data: urlData } = await admin.storage.from(CHAMADA_BUCKET).createSignedUrl(`${CHAMADA_DIR}/index.json`, 30);
      if (urlData?.signedUrl) {
        const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
        if (res.ok) {
          const parsed = await res.json();
          if (Array.isArray(parsed)) idx = parsed;
        }
      }
    } catch { /* índice inexistente ainda */ }
    idx = mutate(idx);
    const blob = new Blob([JSON.stringify(idx)], { type: 'application/json' });
    await admin.storage.from(CHAMADA_BUCKET).upload(`${CHAMADA_DIR}/index.json`, blob, {
      contentType: 'application/json',
      upsert: true,
    });
  });
  // mantém a fila viva mesmo se uma tarefa falhar
  indexChain = task.catch(() => {});
  return task as Promise<void>;
}

/**
 * Lista as datas que têm chamada de um núcleo (do índice), mais recentes primeiro.
 * Complementa com as pastas de checkins existentes (compatibilidade com datas antigas).
 */
export async function datasComChamada(nucleoSlug: string): Promise<string[]> {
  const datas = new Set<string>();
  try {
    const { data: urlData } = await admin.storage.from(CHAMADA_BUCKET).createSignedUrl(`${CHAMADA_DIR}/index.json`, 30);
    if (urlData?.signedUrl) {
      const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
      if (res.ok) {
        const idx = await res.json();
        for (const item of Array.isArray(idx) ? idx : []) {
          if (item?.nucleo === nucleoSlug && typeof item?.data === 'string') datas.add(item.data);
        }
      }
    }
  } catch { /* sem índice */ }
  // Compatibilidade: presenças avulsas antigas criaram pastas checkins/{data}
  try {
    const { data: folders } = await admin.storage.from(CHAMADA_BUCKET).list('checkins');
    for (const f of folders || []) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(f.name) && f.metadata === null) datas.add(f.name);
    }
  } catch { /* sem pasta */ }
  return Array.from(datas).sort().reverse();
}

/**
 * Registros avulsos de check-in de uma data: { studentId → { hora, lat, lng, ... } }.
 * Usado pela chamada para pré-marcar presentes e para sincronizar ao salvar.
 */
export async function loadCheckinsBrutos(data: string): Promise<Record<string, { hora?: string; lat: number | null; lng: number | null; local_nome: string | null }>> {
  const out: Record<string, { hora?: string; lat: number | null; lng: number | null; local_nome: string | null }> = {};
  try {
    const { data: files } = await admin.storage.from(CHAMADA_BUCKET).list(`checkins/${data}`);
    if (!files) return out;
    const deleted = new Set(files.filter(f => f.name.endsWith('.deleted')).map(f => f.name.replace('.deleted', '')));
    const ativos = files.filter(f => f.name.endsWith('.json') && !deleted.has(f.name.replace('.json', '')));
    await Promise.all(ativos.map(async f => {
      const sid = f.name.replace('.json', '');
      const { data: urlData } = await admin.storage.from(CHAMADA_BUCKET).createSignedUrl(`checkins/${data}/${f.name}`, 30);
      if (!urlData?.signedUrl) return;
      const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
      if (!res.ok) return;
      try {
        const rec = await res.json();
        out[sid] = { hora: rec?.hora, lat: rec?.lat ?? null, lng: rec?.lng ?? null, local_nome: rec?.local_nome ?? null };
      } catch { /* ignora corrompido */ }
    }));
  } catch { /* pasta inexistente */ }
  return out;
}

/** Remove o registro avulso de check-in (quando a chamada marca o aluno como falta). */
export async function removerCheckinBruto(data: string, studentId: string): Promise<void> {
  try {
    await admin.storage.from(CHAMADA_BUCKET).remove([`checkins/${data}/${studentId}.json`]);
  } catch { /* tolerável */ }
}

/**
 * Aplica FALTA JUSTIFICADA a um aluno numa data específica.
 * Chamada quando uma justificativa é aprovada: cria a chamada da data se não
 * existir (com o aluno justificado e o restante ausente), ou converte a
 * entrada existente do aluno para JU. Nunca altera chamadas de outras datas.
 * Retorna o status aplicado (ou null quando o núcleo/aluno não confere).
 */
export async function aplicarJustificada(
  studentId: string,
  data: string,
  nucleoNomeOuSlug: string,
): Promise<ChamadaStatus | null> {
  // Resolve o slug do núcleo (justificativas guardam o nome do núcleo)
  let slug = nucleoNomeOuSlug;
  const { data: tPorSlug } = await admin
    .from('tenants')
    .select('slug, nome')
    .eq('slug', nucleoNomeOuSlug)
    .limit(1)
    .maybeSingle();
  if (tPorSlug?.slug) {
    slug = String(tPorSlug.slug);
  } else {
    const { data: tPorNome } = await admin
      .from('tenants')
      .select('slug, nome')
      .ilike('nome', nucleoNomeOuSlug)
      .limit(1)
      .maybeSingle();
    if (tPorNome?.slug) slug = String(tPorNome.slug);
  }

  const existente = await loadChamada(data, slug);
  if (existente) {
    const entry = existente.entries.find(e => e.id === studentId);
    if (!entry) return null; // aluno não está na chamada dessa data: não inventa registro
    if (entry.st === 'JU') return 'JU';
    entry.st = 'JU';
    entry.h = horaBR();
    existente.updated_at = new Date().toISOString();
    existente.updated_by = 'sistema:justificativa';
    await saveChamada(existente);
    return 'JU';
  }

  // Sem chamada na data: cria uma com o aluno justificado.
  const { data: alunos } = await admin
    .from('students')
    .select('id, nome_completo')
    .eq('id', studentId)
    .maybeSingle();
  if (!alunos) return null;
  const doc: ChamadaDoc = {
    data,
    nucleo: slug,
    entries: [{ id: studentId, st: 'JU', h: horaBR(), src: 'chamada', n: (alunos as { nome_completo?: string }).nome_completo }],
    updated_at: new Date().toISOString(),
    updated_by: 'sistema:justificativa',
  };
  await saveChamada(doc);
  return 'JU';
}
