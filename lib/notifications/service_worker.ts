/** Registra o SW de bandeja + Web Push. */
export async function ensureNotifyServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return null;
  try {
    const registration = await navigator.serviceWorker.register("/notify-sw.js", { scope: "/" });
    // PushManager.subscribe exige um worker ativo na primeira instalação.
    return registration.active ? registration : await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}
