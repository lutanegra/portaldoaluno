/**
 * Credenciais do painel administrativo.
 * Senhas são armazenadas com hash scrypt (formato "scrypt:salt:hash").
 * Credenciais legadas em texto simples continuam válidas na comparação,
 * para não quebrar logins antigos de responsáveis até serem trocadas.
 */
import crypto from 'crypto';

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
  // Legado: texto simples
  return stored === password;
}

/**
 * Senha padrão do admin de um núcleo: o próprio nome do núcleo
 * (slug sem hífens, minúsculo). Ex.: "CIEP 229" → slug "ciep-229" → "ciep229".
 */
export function defaultPasswordForSlug(slug: string): string {
  const clean = slug.toLowerCase().replace(/-/g, '');
  return clean.length >= 4 ? clean : slug.toLowerCase();
}

/** Paleta de cores para badges de núcleo (usada ao criar credencial). */
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
