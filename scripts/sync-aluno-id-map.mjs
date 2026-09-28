/**
 * Sincroniza o mapa de IDs de exibição (storage) com a numeração oficial
 * ordem_inscricao da tabela students. Idempotente: pode rodar quantas vezes
 * quiser — grava CCLN-XXX para todo aluno numerado e ajusta o contador.
 *
 * Uso: node scripts/sync-aluno-id-map.mjs
 */
process.loadEnvFile?.('./.env');

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('ENV AUSENTE: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const supabase = createClient(url, key);
const BUCKET = 'photos';
const ID_MAP_KEY = 'config/aluno-id-map.json';
const COUNTER_KEY = 'config/aluno-id-counter.json';

const pad3 = (n) => `CCLN-${String(n).padStart(3, '0')}`;

async function loadJson(path) {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 30);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function saveJson(path, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true });
  if (error) throw new Error(error.message);
}

const { data: students, error } = await supabase
  .from('students')
  .select('id, ordem_inscricao')
  .not('ordem_inscricao', 'is', null)
  .order('ordem_inscricao', { ascending: true });
if (error) { console.error('Erro ao ler students:', error.message); process.exit(1); }

const map = (await loadJson(ID_MAP_KEY)) || {};
let changed = 0;
let maxNum = 0;
for (const s of students || []) {
  maxNum = Math.max(maxNum, s.ordem_inscricao);
  const displayId = pad3(s.ordem_inscricao);
  if (map[s.id] !== displayId) { map[s.id] = displayId; changed++; }
}
await saveJson(ID_MAP_KEY, map);
await saveJson(COUNTER_KEY, { last_id: maxNum });
console.log(`Mapa sincronizado: ${changed} ID(s) gravados, contador em ${maxNum}.`);
