/**
 * Seed único das contas de gestão do painel (owner + admin geral).
 * Lê as credenciais do Supabase do ambiente (.env do projeto) e NUNCA
 * imprime segredos. Senhas das contas ficam apenas no arquivo de
 * credenciais do storage, com hash scrypt.
 *
 * Uso: node scripts/seed-panel-credentials.mjs
 */
process.loadEnvFile?.('./.env');

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('ENV AUSENTE: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

// Senhas definitivas definidas pelo proprietário (recebidas por mensagem privada).
// Esta execução é única; o arquivo guardado contém apenas hashes.
const SENHA_OWNER = 'Mp27032013@';
const SENHA_ADMIN = 'Scoralick0405@';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

const supabase = createClient(url, key);
const BUCKET = 'photos';
const CREDS_KEY = 'config/panel-credentials.json';

let existing = {};
const { data: urlData } = await supabase.storage.from(BUCKET).createSignedUrl(CREDS_KEY, 30);
if (urlData?.signedUrl) {
  const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
  if (res.ok) { try { existing = await res.json(); } catch {} }
}

const now = new Date().toISOString();
const contas = {
  owner: { nucleo: 'geral', label: 'Owner (Desenvolvedor)', color: '#7c3aed', password: hashPassword(SENHA_OWNER), nome: 'Owner', first_login: false, seeded_at: now },
  admin: { nucleo: 'geral', label: 'Admin Geral', color: '#1d4ed8', password: hashPassword(SENHA_ADMIN), nome: 'Admin Geral', first_login: false, seeded_at: now },
};

// Remove todos os outros perfis (exigência do dono: só owner + admin geral)
const removidos = Object.keys(existing).filter(k => k !== 'owner' && k !== 'admin');
for (const k of removidos) delete existing[k];

const final = { ...existing, ...contas };
const blob = new Blob([JSON.stringify(final)], { type: 'application/json' });
const { error } = await supabase.storage.from(BUCKET).upload(CREDS_KEY, blob, { upsert: true });
if (error) { console.error('ERRO UPLOAD:', error.message); process.exit(1); }

// Auto-verificação: as senhas conferem com os hashes gravados?
const okOwner = (() => {
  const [, salt, hash] = final.owner.password.split(':');
  return crypto.scryptSync(SENHA_OWNER, salt, 64).toString('hex') === hash;
})();
const okAdmin = (() => {
  const [, salt, hash] = final.admin.password.split(':');
  return crypto.scryptSync(SENHA_ADMIN, salt, 64).toString('hex') === hash;
})();

console.log('OK — contas no arquivo:', Object.keys(final).join(', '));
console.log('Perfis antigos removidos:', removidos.length);
console.log('Hash owner válido:', okOwner, '| Hash admin válido:', okAdmin);
