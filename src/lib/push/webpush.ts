/**
 * WEB PUSH — RFC 8291 (criptografia payloads) + RFC 8292 (VAPID).
 *
 * Implementação autossuficiente em Node (WebCrypto): gera chaves VAPID,
 * assina a requisição e criptografa o payload aes128gcm para o endpoint.
 * Sem dependências externas — roda na runtime Node do Next.js.
 *
 * Uso: sendWebPush(subscription, payload, vapid). expired=true indica
 * subscription morta (404/410) e o chamador a desativa.
 */

import crypto from 'crypto';

export type PushSubscriptionLike = { endpoint: string; keys: { p256dh: string; auth: string } };
export type VapidKeys = { subject: string; publicKey: string; privateKey: string };
export type PushPayload = { title: string; body: string; tag?: string; url?: string };
export type PushResult = { ok: boolean; expired?: boolean; error?: string; status?: number };

const b64u = {
  enc: (buf: ArrayBuffer | Buffer | Uint8Array): string =>
    Buffer.from(buf as Uint8Array).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

/* ── Geração de chaves VAPID (uma vez; guardar nas env vars) ─────────────── */

export async function gerarChavesVapid(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await crypto.webcrypto.subtle.exportKey('raw', pair.publicKey);
  // pkcs8 = ...0420<d(32)> — extrai o escalar privado puro (padrão VAPID)
  const pkcs8 = Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', pair.privateKey));
  const idx = pkcs8.lastIndexOf(Buffer.from([0x04, 0x20]));
  const d = idx >= 0 ? pkcs8.subarray(idx + 2, idx + 2 + 32) : pkcs8;
  return { publicKey: b64u.enc(pub), privateKey: b64u.enc(d) };
}

/* ── Cabeçalho VAPID (RFC 8292) ──────────────────────────────────────────── */

function vapidHeader(endpoint: string, keys: VapidKeys, ttlSeconds = 4 * 3600): Record<string, string> {
  const aud = new URL(endpoint).origin;
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const header = b64u.enc(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u.enc(Buffer.from(JSON.stringify({ aud, exp, sub: keys.subject })));
  const signingInput = `${header}.${claims}`;
  // privateKey VAPID é base64url do escalar d — reconstrói a chave EC (SEC1)
  const d = b64u.dec(keys.privateKey);
  const sec1 = Buffer.concat([
    Buffer.from([0x30, 0x77, 0x02, 0x01, 0x01, 0x04, 0x20]),
    d,
    Buffer.from([0xa0, 0x0a, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]),
    Buffer.from([0xa1, 0x44, 0x03, 0x42, 0x00]),
    b64u.dec(keys.publicKey),
  ]);
  const keyObj = crypto.createPrivateKey({ key: sec1, format: 'der', type: 'sec1' });
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key: keyObj, dsaEncoding: 'ieee-p1363' });
  return {
    Authorization: `vapid t=${header}.${claims}.${b64u.enc(sig)}, k=${keys.publicKey}`,
    TTL: String(ttlSeconds),
    'Content-Encoding': 'aes128gcm',
  };
}

/* ── Criptografia do payload (aes128gcm, RFC 8188/8291) ──────────────────── */

async function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Promise<Buffer> {
  const key = await crypto.webcrypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(salt), info: new Uint8Array(info) },
    key,
    length * 8,
  );
  return Buffer.from(bits);
}

async function criptografarPayload(payload: Buffer, p256dhB64: string, authB64: string): Promise<Buffer> {
  const uaPublic = b64u.dec(p256dhB64);
  const authSecret = b64u.dec(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('Chave p256dh inválida.');
  if (authSecret.length < 16) throw new Error('Secret auth inválido.');

  // Par efêmero ECDH P-256
  const eph = await crypto.webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephRaw = Buffer.from(await crypto.webcrypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.webcrypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = Buffer.from(await crypto.webcrypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));

  // PRK e IKM conforme RFC 8291
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, ephRaw]);
  const prk = await hkdf(authSecret, shared, keyInfo, 32);
  const salt = crypto.randomBytes(16);
  const cek = await hkdf(salt, prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  // Record: payload + delimitador 0x02 (último registro)
  const record = Buffer.concat([payload, Buffer.from([0x02])]);
  const cryptoKey = await crypto.webcrypto.subtle.importKey('raw', cek, 'aes-gcm', false, ['encrypt']);
  const ciphertext = Buffer.from(await crypto.webcrypto.subtle.encrypt({ name: 'aes-gcm', iv: new Uint8Array(nonce), tagLength: 128 }, cryptoKey, record));

  // Cabeçalho aes128gcm: salt(16) | rs(4) | idlen(1) | id(65)
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = 65;
  return Buffer.concat([header, ephRaw, ciphertext]);
}

/* ── Envio ───────────────────────────────────────────────────────────────── */

export async function sendWebPush(sub: PushSubscriptionLike, payload: PushPayload, vapid: VapidKeys): Promise<PushResult> {
  if (!vapid.publicKey || !vapid.privateKey) {
    return { ok: false, error: 'Chaves VAPID não configuradas no servidor.' };
  }
  try {
    const body = await criptografarPayload(Buffer.from(JSON.stringify(payload), 'utf8'), sub.keys.p256dh, sub.keys.auth);
    const headers = {
      ...vapidHeader(sub.endpoint, vapid),
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      Urgency: 'normal',
    };
    const res = await fetch(sub.endpoint, { method: 'POST', headers, body: new Uint8Array(body) });
    if (res.ok || res.status === 201) return { ok: true, status: res.status };
    if (res.status === 404 || res.status === 410) return { ok: false, expired: true, status: res.status, error: `Subscription expirada (${res.status}).` };
    const txt = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: `Endpoint respondeu ${res.status}: ${txt.slice(0, 180)}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
