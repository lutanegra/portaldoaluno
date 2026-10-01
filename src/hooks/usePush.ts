'use client';

/**
 * HOOK DE WEB PUSH — Ginga Gestão
 *
 * Registro do service worker, permissão do navegador (sempre após interação),
 * subscription com a chave VAPID pública e associação ao usuário autenticado
 * (o servidor lê a sessão no cookie — nunca confia no corpo).
 *
 * Estados cobertos: sem suporte, iOS sem PWA instalado, permissão negada,
 * pendente, ativado. Sem reconvocar permissão repetidamente.
 */
import { useCallback, useEffect, useState } from 'react';

export type PushState = 'carregando' | 'sem_suporte' | 'ios_instalar' | 'negado' | 'pendente' | 'ativo' | 'servidor_off';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function usePush(authenticated: boolean) {
  const [state, setState] = useState<PushState>('carregando');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [swReg, setSwReg] = useState<ServiceWorkerRegistration | null>(null);
  const [vapidKey, setVapidKey] = useState('');
  const [busy, setBusy] = useState(false);

  // Registro do SW + estado inicial (uma vez)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (alive) setState('sem_suporte');
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        if (!alive) return;
        setSwReg(reg);
        const p = Notification.permission;
        setPermission(p);
        if (p === 'denied') { setState('negado'); return; }
        if (p === 'granted') {
          const existing = await reg.pushManager.getSubscription();
          setState(existing ? 'ativo' : 'pendente');
        } else {
          setState('pendente');
        }
      } catch {
        if (alive) setState('sem_suporte');
      }
    })();
    return () => { alive = false; };
  }, []);

  // Chave pública do servidor
  useEffect(() => {
    if (!authenticated) return;
    fetch('/api/notificacoes')
      .then(r => r.json())
      .then(d => { if (d.vapidPublicKey) setVapidKey(d.vapidPublicKey); })
      .catch(() => {});
  }, [authenticated]);

  /** Ativa: pede permissão (chamado só de clique), inscreve e envia ao servidor. */
  const ativar = useCallback(async (): Promise<{ ok: boolean; erro?: string }> => {
    if (!swReg) return { ok: false, erro: 'Service worker indisponível neste navegador.' };
    if (!vapidKey) return { ok: false, erro: 'Push não está configurado no servidor ainda.' };
    setBusy(true);
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') {
        setState(p === 'denied' ? 'negado' : 'pendente');
        return { ok: false, erro: 'Permissão não concedida.' };
      }
      let sub = await swReg.pushManager.getSubscription();
      if (!sub) {
        sub = await swReg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
        });
      }
      const j = sub.toJSON();
      const res = await fetch('/api/notificacoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'subscribe',
          endpoint: j.endpoint,
          keys: j.keys,
          expirationTime: sub.expirationTime ?? null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return { ok: false, erro: d.error || 'Falha ao registrar o dispositivo.' };
      }
      setState('ativo');
      return { ok: true };
    } catch (e) {
      return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao ativar as notificações.' };
    } finally {
      setBusy(false);
    }
  }, [swReg, vapidKey]);

  /** Desativa neste navegador e revoga no servidor. */
  const desativar = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      if (swReg) {
        const sub = await swReg.pushManager.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await fetch('/api/notificacoes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unsubscribe-by-endpoint', endpoint }),
          });
          await sub.unsubscribe().catch(() => {});
        }
      }
      setState('pendente');
    } finally {
      setBusy(false);
    }
  }, [swReg]);

  // Ao deslogar: desassocia o dispositivo da conta (sem desinscrever o navegador)
  useEffect(() => {
    if (authenticated) return;
    if (state === 'ativo' && swReg) {
      swReg.pushManager.getSubscription().then(sub => {
        if (sub) return fetch('/api/notificacoes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unsubscribe-by-endpoint', endpoint: sub.endpoint, sem_conta: true }),
        }).catch(() => {});
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  return { state, permission, ativar, desativar, busy, vapidKey };
}
