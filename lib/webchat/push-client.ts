import { ensureNotifyServiceWorker } from "@/lib/notifications/service_worker";
import { vapidKeyBytes } from "@/lib/notifications/push-key";

function csrfAtual(): string | null {
  const pair = document.cookie.split("; ").find((item) => item.startsWith("webchat_csrf="));
  return pair ? decodeURIComponent(pair.slice("webchat_csrf=".length)) : null;
}

export function instaladoNaTelaInicial(): boolean {
  if (typeof window === "undefined") return false;
  const appleStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return appleStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

export function iphoneOuIpad(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function precisaInstalarNoIphone(): boolean {
  return iphoneOuIpad() && !instaladoNaTelaInicial();
}

export function assinarInstalacao(onChange: () => void): () => void {
  window.addEventListener("appinstalled", onChange);
  return () => window.removeEventListener("appinstalled", onChange);
}

export async function inscreverPushVisitante(publicId?: string): Promise<"ok" | "unavailable"> {
  const registration = await ensureNotifyServiceWorker();
  if (!registration?.pushManager) return "unavailable";
  const headers: Record<string, string> = {};
  if (publicId) headers["x-webchat-public-id"] = publicId;
  const configResponse = await fetch("/api/public/webchat/push", { credentials: "same-origin", headers });
  const config = await configResponse.json().catch(() => null) as
    { data?: { enabled?: boolean; public_key?: string } } | null;
  if (!configResponse.ok || !config?.data?.enabled || !config.data.public_key) return "unavailable";
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(config.data.public_key) as BufferSource,
    });
  }
  const json = subscription.toJSON();
  const csrf = csrfAtual();
  if (!csrf || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "unavailable";
  const response = await fetch("/api/public/webchat/push", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-webchat-csrf": csrf, ...headers },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return response.ok ? "ok" : "unavailable";
}
