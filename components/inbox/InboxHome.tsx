"use client";

import { useT } from "@/hooks/i18n/useT";
import { useConversationCounts } from "@/hooks/inbox/useConversationCounts";
import { Button } from "@/components/ui/button";
import { ChatCircle, CheckCircle, Clock, Keyboard, MagnifyingGlass, Robot, UserCircle } from "@/lib/ui/icons";
import type { InboxTab } from "./InboxFilters";

interface Props {
  orgId: string | null;
  name?: string | null;
  onQueue: (tab: InboxTab) => void;
  onSearch: () => void;
  onHelp: () => void;
}

/** Read-only entry point: the same RLS-scoped counts as the queue tabs.
 * Cards intentionally ignore auxiliary filters; their action clears those
 * filters too. Unknown/error counts are never presented as zero work.
 */
export function InboxHome({ orgId, name, onQueue, onSearch, onHelp }: Props) {
  const t = useT();
  const counts = useConversationCounts(orgId);
  const data = counts.isError ? undefined : counts.data;
  const queues = [
    { tab: "unassigned", label: t("Fila"), description: t("Conversas aguardando atendimento humano."), icon: Clock, count: data?.fila ?? data?.unassigned },
    { tab: "mine", label: t("Minhas"), description: t("Conversas em aberto atribuídas a você."), icon: UserCircle, count: data?.mine },
    { tab: "ai", label: t("Automático"), description: t("Conversas conduzidas pelo atendimento automático."), icon: Robot, count: data?.automatico },
    { tab: "closed", label: t("Encerrados"), description: t("Histórico de conversas encerradas."), icon: CheckCircle, count: data?.encerrados ?? (data?.closed != null && data?.archived != null ? data.closed + data.archived : undefined) },
  ] as const;

  return (
    <section className="crm-inbox-home" aria-label={t("Início do operador")}>
      <header className="crm-home-header">
        <div>
          <p className="text-xs text-muted-foreground">{t("Atendimentos")}</p>
          <h1 className="text-xl font-semibold">{t("Visão geral")}</h1>
          {name?.trim() ? <p className="mt-1 break-words text-sm text-muted-foreground">{name}</p> : null}
        </div>
        <Button variant="outline" size="sm" onClick={onHelp}>
          <Keyboard size={16} aria-hidden />{t("Atalhos de teclado")}
        </Button>
      </header>

      <p className="text-sm text-muted-foreground">
        {t("Contagens do seu acesso, sem os filtros da lista. Os atalhos abrem a visão completa.")}
      </p>
      {counts.isError ? (
        <div className="crm-home-feedback" role="alert">
          <p>{t("Não foi possível atualizar as contagens.")}</p>
          <Button variant="outline" size="sm" disabled={counts.isFetching} onClick={() => void counts.refetch()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : counts.isPending ? <p role="status" className="text-sm text-muted-foreground">{t("Carregando contagens…")}</p> : null}

      <div className="crm-home-queues" role="group" aria-label={t("Visões do atendimento")}>
        {queues.map(({ tab, label, description, icon: Icon, count }) => (
          <button key={tab} type="button" className="crm-home-queue" onClick={() => onQueue(tab)} aria-label={t("Abrir {visao}").replace("{visao}", label)}>
            <span className="crm-home-queue-icon"><Icon size={24} aria-hidden /></span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="crm-home-count" aria-label={count == null ? t("Contagem indisponível") : undefined}>{count ?? "—"}</span>
              <span className="block text-xs text-muted-foreground">{description}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="crm-home-start">
        <ChatCircle size={40} weight="thin" className="text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold">{t("Selecione uma conversa")}</h2>
        <p className="max-w-md text-sm text-muted-foreground">{t("Escolha um atendimento na lista para ver as mensagens e a ficha do contato.")}</p>
        <Button onClick={onSearch}><MagnifyingGlass size={16} aria-hidden />{t("Buscar conversas")}</Button>
        <p className="text-xs text-muted-foreground">{t("Ou navegue com J e K")}</p>
      </div>
    </section>
  );
}
