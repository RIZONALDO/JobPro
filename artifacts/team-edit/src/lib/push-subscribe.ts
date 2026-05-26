// ─── Push Subscription helper ─────────────────────────────────────────────
// Registra o service worker, pede permissão e envia a subscription para a API.

import { apiFetch, apiPost } from "./api";

const SW_PATH = "/sw.js";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

/** Retorna true se Push API é suportada neste browser */
export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window;
}

/** Retorna a permissão atual sem pedir nada */
export function getPushPermission(): NotificationPermission {
  return Notification.permission;
}

/**
 * Solicita permissão, registra SW, cria subscription e envia para a API.
 * Retorna 'granted' | 'denied' | 'unsupported' | 'error'
 */
export async function subscribePush(): Promise<"granted" | "denied" | "unsupported" | "error"> {
  if (!isPushSupported()) return "unsupported";

  // 1. Buscar chave pública VAPID
  let publicKey: string;
  try {
    const data = await apiFetch<{ publicKey: string }>("/api/push/vapid-public-key");
    publicKey = data.publicKey;
  } catch {
    // Servidor não tem VAPID configurado — silencioso
    return "unsupported";
  }

  // 2. Pedir permissão
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  // 3. Registrar service worker
  let reg: ServiceWorkerRegistration;
  try {
    reg = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
    await navigator.serviceWorker.ready;
  } catch {
    return "error";
  }

  // 4. Criar subscription no browser
  let sub: PushSubscription;
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  } catch {
    return "error";
  }

  // 5. Enviar para API
  try {
    const json = sub.toJSON();
    await apiPost("/api/push/subscribe", {
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    });
  } catch {
    return "error";
  }

  return "granted";
}

/**
 * Remove a subscription do browser e da API.
 */
export async function unsubscribePush(): Promise<void> {
  if (!isPushSupported()) return;

  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_PATH);
    if (!reg) return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await apiFetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).catch(() => {});
  } catch { /**/ }
}

/**
 * Tenta auto-subscribe silenciosamente se já havia permissão concedida.
 * Chamado no mount do Shell para reativar subscription após re-login.
 */
export async function autoResubscribeIfGranted(): Promise<void> {
  if (!isPushSupported()) return;
  if (Notification.permission !== "granted") return;

  // Verificar se já tem subscription ativa no browser
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => null);
  if (!reg) { await subscribePush(); return; }

  const existing = await reg.pushManager.getSubscription().catch(() => null);
  if (!existing) { await subscribePush(); return; }

  // Já tem subscription — garantir que está no servidor
  try {
    const json = existing.toJSON();
    await apiPost("/api/push/subscribe", {
      endpoint: existing.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    });
  } catch { /**/ }
}
