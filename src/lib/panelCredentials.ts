/**
 * Contas de acesso do painel (owner, admins gerais e admins de núcleo).
 * Armazenadas em config/panel-credentials.json no Supabase Storage (bucket privado).
 * Senhas com hash scrypt. Campos opcionais: cpf (11 dígitos, também é login) e
 * email (recuperação de senha).
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
export const CREDS_KEY = 'config/panel-credentials.json';
export const OWNER_KEY = 'owner';

export interface PanelAccount {
  nucleo: string;          // slug do núcleo principal ou 'geral'
  nucleos?: string[];      // slugs adicionais: admin de núcleo pode gerenciar vários
  label: string;
  color: string;
  password: string;        // hash scrypt ou legado em texto simples
  email?: string;
  cpf?: string;            // apenas dígitos; pode ser usado como login
  nome?: string;
  createdBy?: string;
  first_login?: boolean;
}

export type CredsMap = Record<string, PanelAccount>;

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (typeof stored === 'string' && stored.startsWith('scrypt:')) {
    const [, salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    try {
      const test = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
    } catch {
      return false;
    }
  }
  return stored === password;
}

export function normalizeLogin(s: string): string {
  return (s || '').trim().toLowerCase();
}

export function normalizeCpfDigits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

export function normalizeEmail(s: string): string {
  return (s || '').trim().toLowerCase();
}

/** Contas fixas de gestão — garantidas sempre (seed). Senhas com hash scrypt. */
export const DEFAULT_CREDS: CredsMap = {
  owner: { nucleo: 'geral', label: 'Owner (Desenvolvedor)', color: '#7c3aed', password: hashPassword('Mp27032013@'), first_login: false },
  admin: { nucleo: 'geral', label: 'Admin Geral', color: '#1d4ed8', password: hashPassword('Scoralick0405@'), first_login: false },
};

export const GERAL_KEY = 'geral';

/** Conta é de gestão (owner/admin geral) — enxerga tudo. */
export function accIsGeral(acc: PanelAccount | undefined): boolean {
  if (!acc) return false;
  return acc.nucleo === GERAL_KEY;
}

/** Lista normalizada de núcleos que a conta gerencia (slugs; vazio = gestão geral). */
export function accNucleos(acc: PanelAccount | undefined): string[] {
  if (!acc || accIsGeral(acc)) return [];
  const primary = (acc.nucleo || '').trim();
  const list = Array.isArray(acc.nucleos) ? acc.nucleos.map(s => String(s).trim()) : [];
  const all = [primary, ...list].filter(s => s && s !== GERAL_KEY);
  return Array.from(new Set(all));
}

/**
 * Verifica se um núcleo (por slug ou nome) pertence à lista permitida.
 * `tenantNames` mapeia slug → nome, permitindo conferir registros gravados com o nome.
 */
export function accHasNucleo(
  acc: PanelAccount | undefined,
  slugOrNome: string,
  tenantNames?: Record<string, string>,
): boolean {
  const alvo = (slugOrNome || '').trim().toLowerCase();
  if (!alvo || accIsGeral(acc)) return false;
  const nomes = tenantNames || {};
  return accNucleos(acc).some(slug => {
    if (slug.toLowerCase() === alvo) return true;
    const nome = (nomes[slug] || '').trim().toLowerCase();
    return !!nome && nome === alvo;
  });
}

export async function loadCreds(): Promise<CredsMap> {
  try {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(CREDS_KEY, 30);
    if (!data?.signedUrl) return { ...DEFAULT_CREDS };
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_CREDS };
    const stored = await res.json();
    return { ...DEFAULT_CREDS, ...stored };
  } catch {
    return { ...DEFAULT_CREDS };
  }
}

export async function saveCreds(map: CredsMap): Promise<void> {
  const blob = new Blob([JSON.stringify(map)], { type: 'application/json' });
  await supabase.storage.from(BUCKET).upload(CREDS_KEY, blob, { upsert: true });
}

/** Índice de logins alternativos: cpf → username, email → username. */
export function buildAltIndex(creds: CredsMap): { byCpf: Record<string, string>; byEmail: Record<string, string> } {
  const byCpf: Record<string, string> = {};
  const byEmail: Record<string, string> = {};
  for (const [username, acc] of Object.entries(creds)) {
    const cpf = normalizeCpfDigits((acc as PanelAccount).cpf || '');
    if (cpf.length === 11 && !byCpf[cpf]) byCpf[cpf] = username;
    const email = normalizeEmail((acc as PanelAccount).email || '');
    if (email.includes('@') && !byEmail[email]) byEmail[email] = username;
  }
  return { byCpf, byEmail };
}

/**
 * Resolve o username real a partir de login (username), CPF ou e-mail.
 * Retorna null quando não encontra.
 */
export function resolveUsername(creds: CredsMap, rawLogin: string): string | null {
  const login = normalizeLogin(rawLogin);
  if (!login) return null;
  if (creds[login]) return login;
  const digits = normalizeCpfDigits(rawLogin);
  if (digits.length === 11) {
    const byCpf = buildAltIndex(creds).byCpf;
    if (byCpf[digits]) return byCpf[digits];
  }
  if (login.includes('@')) {
    const byEmail = buildAltIndex(creds).byEmail;
    if (byEmail[login]) return byEmail[login];
  }
  return null;
}

/**
 * Garante a existência do usuário auth no Supabase para o e-mail dado
 * (recuperação de senha via Supabase Auth). Sem e-mail, não cria nada.
 * user_metadata guarda o login do painel para o reset sincronizar.
 */
export async function ensureSupabaseAuthUser(email: string, panelUsername: string, nome?: string): Promise<{ id?: string; error?: string }> {
  if (!email || !email.includes('@')) return {};
  const { data: list } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  const existing = list?.users?.find(u => (u.email || '').toLowerCase() === email);
  if (existing) {
    const meta = (existing.user_metadata || {}) as Record<string, unknown>;
    if (meta.panel_login !== panelUsername) {
      await supabase.auth.admin.updateUserById(existing.id, {
        user_metadata: { ...meta, panel_login: panelUsername, panel_nome: nome || '' },
      });
    }
    return { id: existing.id };
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { panel_login: panelUsername, panel_nome: nome || '' },
  });
  if (error) return { error: error.message };
  return { id: data?.user?.id };
}

export function publicAccount(username: string, acc: PanelAccount, nucleoNome?: string | null) {
  return {
    username,
    label: acc.label,
    nucleo: acc.nucleo,
    nucleos: accNucleos(acc),
    nucleo_nome: nucleoNome ?? null,
    color: acc.color,
    nome: acc.nome || '',
    email: acc.email || '',
    cpf: acc.cpf || '',
    first_login: acc.first_login === true,
    is_owner: username === OWNER_KEY,
    is_geral: accIsGeral(acc),
  };
}

/** Normaliza lista de slugs de núcleos vinda de payload: strings, dedupe, sem 'geral'. */
export function sanitizeNucleoSlugs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const list = input
    .map(s => String(s || '').trim())
    .filter(s => s && s !== GERAL_KEY);
  return Array.from(new Set(list));
}

/** Senha padrão do admin de um núcleo: o próprio nome do núcleo. */
export function defaultPasswordForSlug(slug: string): string {
  const clean = slug.toLowerCase().replace(/-/g, '');
  return clean.length >= 4 ? clean : slug.toLowerCase();
}

export const NUCLEO_COLOR_PALETTE = [
  '#0ea5e9', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed',
  '#0d9488', '#db2777', '#4f46e5', '#ca8a04', '#059669',
];

export function pickColorForSlug(slug: string): string {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return NUCLEO_COLOR_PALETTE[h % NUCLEO_COLOR_PALETTE.length];
}

export const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo'] as const;

export function sanitizeDiasTreino(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const allowed = new Set<string>(DIAS_SEMANA);
  return Array.from(new Set(input.filter((d): d is string => typeof d === 'string' && allowed.has(d))));
}

/** Horário por dia: { "segunda": "19:00", ... } — só dias válidos e HH:MM real. */
export function sanitizeHorariosTreino(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [dia, valor] of Object.entries(input as Record<string, unknown>)) {
    if (!(DIAS_SEMANA as readonly string[]).includes(dia)) continue;
    if (typeof valor !== 'string') continue;
    const m = valor.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (m) out[dia] = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return out;
}

/** Horário de TÉRMINO por dia — mesmo formato de sanitizeHorariosTreino. */
export function sanitizeHorariosFimTreino(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [dia, valor] of Object.entries(input as Record<string, unknown>)) {
    if (!(DIAS_SEMANA as readonly string[]).includes(dia)) continue;
    if (typeof valor !== 'string') continue;
    const m = valor.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (m) out[dia] = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return out;
}

/** Tolerância em minutos (0–120). Inválida → undefined (mantém a atual). */
export function parseToleranciaMin(input: unknown): number | undefined {
  if (input === null || input === '' || input === undefined) return undefined;
  const n = Math.round(Number(input));
  if (!Number.isFinite(n) || n < 0 || n > 120) return undefined;
  return n;
}
