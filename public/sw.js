/* Ginga Gestão — Service Worker
 *
 * Responsabilidades:
 *  1. Web Push: exibir notificação, tratar clique e abrir o app no destino.
 *  2. PWA mínimo: manifest + cache offline da casca (network-first com fallback).
 *
 * Nunca intercepta as chamadas de API (sempre rede), para não servir dados
 * de sessão velhos nem quebrar autenticação.
 */

const CACHE = 'ginga-shell-v1';
const SHELL = ['/', '/logo-portal-aluno.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => {}),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Network-first com fallback offline apenas para navegações e estáticos do app.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // APIs sempre direto da rede (dados sensíveis / sessão).
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        // Cacheia apenas a casca e assets estáticos
        if (fresh && fresh.status === 200 && (req.mode === 'navigate' || url.pathname.startsWith('/_next/static') || SHELL.includes(url.pathname))) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        throw new Error('offline');
      }
    })(),
  );
});

/* ── Push ────────────────────────────────────────────────────────────────── */

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Ginga Gestão', body: 'Você recebeu uma nova atualização.' };
  }
  const title = String(data.title || 'Ginga Gestão');
  const body = String(data.body || 'Você recebeu uma nova atualização.');
  const url = String(data.url || '/');
  const tag = String(data.tag || 'ginga');

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      icon: '/logo-portal-aluno.png',
      badge: '/logo-portal-aluno.png',
      data: { url },
      vibrate: [80, 40, 80],
    }).catch(() => {}),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const alvo = new URL(url, self.location.origin).href;
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          await client.focus();
          // Navega o app aberto para o destino (via postMessage; o app trata ?aba=)
          client.postMessage({ type: 'navigate', url });
          return;
        }
      }
      await self.clients.openWindow(alvo);
    })(),
  );
});
