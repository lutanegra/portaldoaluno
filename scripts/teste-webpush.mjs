// Teste de ponta a ponta da criptografia Web Push (RFC 8291/8292):
// 1. deriva o par VAPID, 2. simula o cliente (browser) que gera par p256dh+auth,
// 3. criptografa no servidor e descriptografa "no browser", comparando o payload.
import crypto from 'crypto';
import { gerarChavesVapid, sendWebPush } from '../src/lib/push/webpush.ts';

const b64u = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const enc = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// "Browser": par ECDH do destinatário + auth secret
const uaPair = await crypto.webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublic = enc(await crypto.webcrypto.subtle.exportKey('raw', uaPair.publicKey));
const auth = enc(crypto.randomBytes(16));

// Intercepta o fetch para "ser" o endpoint de push e descriptografar
const payloadOriginal = { title: 'Ginga Gestão', body: 'Teste de criptografia', url: '/?aba=mural' };
let payloadRecebido = null;
let vapidAuthHeader = null;

globalThis.fetch = async (endpoint, opts) => {
  vapidAuthHeader = opts.headers.Authorization;
  // Descriptografa como o browser faria (RFC 8291 aes128gcm)
  const body = Buffer.from(opts.body);
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const ephPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);

  const uaPriv = uaPair.privateKey;
  const ephKey = await crypto.webcrypto.subtle.importKey('raw', ephPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = Buffer.from(await crypto.webcrypto.subtle.deriveBits({ name: 'ECDH', public: ephKey }, uaPriv, 256));

  async function hkdf(s, ikm, info, len) {
    const key = await crypto.webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.webcrypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(s), info: new Uint8Array(info) }, key, len * 8);
    return Buffer.from(bits);
  }
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), b64u(uaPublic), ephPublic]);
  const prk = await hkdf(b64u(auth), shared, keyInfo, 32);
  const cek = await hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  const cryptoKey = await crypto.webcrypto.subtle.importKey('raw', cek, 'aes-gcm', false, ['decrypt']);
  const plain = Buffer.from(await crypto.webcrypto.subtle.decrypt({ name: 'aes-gcm', iv: new Uint8Array(nonce), tagLength: 128 }, cryptoKey, ciphertext));
  payloadRecebido = JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8')); // remove padding delimiter

  return { ok: true, status: 201, text: async () => '' };
};

const vapid = await gerarChavesVapid();
const res = await sendWebPush(
  { endpoint: 'https://fcm.googleapis.com/fcm/send/teste', keys: { p256dh: uaPublic, auth } },
  payloadOriginal,
  { subject: 'mailto:teste@teste.com', ...vapid },
);

console.log('resultado:', res);
console.log('vapid header presente:', !!vapidAuthHeader && vapidAuthHeader.startsWith('vapid t='));
console.log('payload original :', JSON.stringify(payloadOriginal));
console.log('payload decryptado:', JSON.stringify(payloadRecebido));
const ok = res.ok && payloadRecebido && JSON.stringify(payloadRecebido) === JSON.stringify(payloadOriginal) && vapidAuthHeader?.startsWith('vapid t=');
console.log(ok ? 'CRIPTOGRAFIA OK — payload idêntico após descriptografar' : 'FALHA NA CRIPTOGRAFIA');
process.exit(ok ? 0 : 1);
