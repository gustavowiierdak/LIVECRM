"use client";

import { useCallback, useSyncExternalStore } from "react";

import { emitNotification } from "@/lib/notifications/emit";
import {
  areAlertsEnabled,
  assinarPermissao,
  getPermission,
  requestPermission,
  setAlertsEnabled,
  type NotificationPermissionState,
} from "@/lib/notifications/permission";
import {
  getPushStatus,
  getServerPushStatus,
  subscribePushStatus,
  syncPushSubscription,
  type PushStatus,
} from "@/lib/notifications/push_client";
import { resumeAudio } from "@/lib/notifications/sounds";

function confirmOnOs(on: boolean, background = false): void {
  emitNotification({
    kind: "alerts_toggle",
    title: on
      ? background
        ? "Notificações ativadas"
        : "Permissão de notificações liberada"
      : "Alertas desligados",
    body: on
      ? background
        ? "Este navegador está pronto para receber avisos de novas mensagens."
        : "Os avisos estão disponíveis com o site aberto."
      : "Este navegador não vai mais avisar na bandeja.",
    force: true,
    sound: on ? "success" : "failure",
  });
}

export function useNotificationPermission(): {
  permission: NotificationPermissionState;
  enabled: boolean;
  pushStatus: PushStatus;
  request: () => Promise<NotificationPermissionState>;
  setEnabled: (on: boolean) => void;
} {
  /**
   * ⚠️ LIDA NO RENDER, NÃO NUM EFEITO — e isso conserta uma tela, não um teste.
   *
   * Isto era `useState("default")` + `useEffect(() => setPermission(...))`, e o
   * `"default"` é um CHUTE: ele significa "o navegador ainda não perguntou",
   * que é uma das três respostas possíveis, escolhida antes de olhar. Como
   * `denied` desabilita o interruptor de Push em `_client.tsx`, a sequência era:
   *
   *   1. primeiro render → `"default"` → interruptor HABILITADO;
   *   2. o efeito roda DEPOIS do paint, lê `denied`, e ele desabilita sozinho.
   *
   * Quem tem a notificação bloqueada no navegador via, por um instante, um
   * controle pronto para uso que sumia na frente dele — e um clique naquela
   * janela ia parar num `request()` que já estava decidido.
   *
   * `useSyncExternalStore` lê o valor no PRÓPRIO render e reconcilia junto com
   * a hidratação, sem chute e sem janela. No servidor `getPermission()` devolve
   * `"unsupported"` sozinho (não existe `Notification` lá), o que é a verdade
   * daquele ambiente e desabilita o controle no HTML — o único flash que sobra
   * é o seguro, de desabilitado para habilitado, que nunca oferece o que talvez
   * não funcione.
   *
   * O custo dessa janela não foi teórico: ela deixou
   * `tests/e2e/notificacoes-diz-o-que-falta.spec.ts` passando por SORTE, e o
   * primeiro PR a mudar o timing o bastante para perder a corrida ficou vermelho
   * sem ter quebrado nada.
   */
  const permission = useSyncExternalStore(assinarPermissao, getPermission, getPermission);
  const enabled = useSyncExternalStore(assinarPermissao, areAlertsEnabled, () => false);
  const pushStatus = useSyncExternalStore(subscribePushStatus, getPushStatus, getServerPushStatus);

  const request = useCallback(async () => {
    // A chamada nativa precisa acontecer dentro do clique, antes de qualquer
    // await: esperar pelo áudio pode perder a ativação transitória do usuário.
    const permissionRequest = requestPermission();
    void resumeAudio().catch(() => {});
    const next = await permissionRequest;
    if (next === "granted") {
      setAlertsEnabled(true);
      const result = await syncPushSubscription();
      if (result !== "error") confirmOnOs(true, result === "ready");
    }
    return next;
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setAlertsEnabled(on);
    if (on) {
      void resumeAudio().catch(() => {});
      void syncPushSubscription();
    }
    confirmOnOs(on);
  }, []);

  return { permission, enabled, pushStatus, request, setEnabled };
}
