import { areAlertsEnabled, getPermission } from "./permission";
import { ensureNotifyServiceWorker } from "./service_worker";
import { vapidKeyBytes } from "./push-key";

export type PushStatus =
  "idle" | "syncing" | "ready" | "server_unavailable" | "unsupported" | "error" | "disabled";
let status: PushStatus = "idle";
const listeners = new Set<() => void>();
export const getPushStatus = () => status;
export const getServerPushStatus = (): PushStatus => "idle";
export function subscribePushStatus(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(next: PushStatus): PushStatus {
  status = next;
  listeners.forEach((listener) => listener());
  return next;
}

let pending: Promise<PushStatus> | null = null;
/** A permissão do navegador não prova que o servidor salvou a inscrição. */
export function syncPushSubscription(): Promise<PushStatus> {
  if (pending) return pending;
  pending = synchronize().finally(() => {
    pending = null;
  });
  return pending;
}

async function synchronize(): Promise<PushStatus> {
  if (typeof window === "undefined") return "idle";
  if (getPermission() !== "granted" || !areAlertsEnabled()) return publish("disabled");
  publish("syncing");
  try {
    const reg = await ensureNotifyServiceWorker();
    if (!reg?.pushManager) return publish("unsupported");

    const response = await fetch("/api/v1/notifications/push");
    if (!response.ok) return publish("error");
    const cfg = await response.json();
    const publicKey = cfg?.data?.public_key as string | undefined;
    if (!cfg?.data?.enabled || !publicKey) return publish("server_unavailable");

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyBytes(publicKey) as BufferSource,
      });
    }

    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return publish("error");

    const saved = await fetch("/api/v1/notifications/push", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });
    return publish(saved.ok ? "ready" : "error");
  } catch {
    return publish("error");
  }
}
