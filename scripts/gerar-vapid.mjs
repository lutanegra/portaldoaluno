/**
 * GERAÇÃO DAS CHAVES VAPID — script operacional (roda no servidor via bash).
 * Uso: npx tsx scripts/gerar-vapid.mjs   (ou node com ts-node equivalente)
 * Imprime o par a colocar nas variáveis de ambiente VAPID_PUBLIC_KEY e
 * VAPID_PRIVATE_KEY. A chave privada NUNCA vai para o repositório.
 *
 * Implementação inline (sem import do src) para rodar com node puro.
 */
import crypto from 'crypto';

const pair = await crypto.webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const raw = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const publicKey = raw(await crypto.webcrypto.subtle.exportKey('raw', pair.publicKey));
const pkcs8 = Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
// PKCS#8 EC key → extrai os 32 bytes do escalar privado d
const idx = pkcs8.lastIndexOf(Buffer.from([0x04, 0x20]));
const privateKey = raw(idx >= 0 ? pkcs8.subarray(idx + 2, idx + 2 + 32) : pkcs8);

console.log('VAPID_PUBLIC_KEY=' + publicKey);
console.log('VAPID_PRIVATE_KEY=' + privateKey);
console.log('# VAPID_SUBJECT=mailto:seu-email@dominio');
