"use client";

import { useMemo, useState } from "react";
import { useActiveOrg, usePermission, useUser } from "@/hooks/auth/AuthProvider";
import { useConversationNotesQuery } from "@/hooks/inbox/useConversationNotes";
import { useDeleteNote } from "@/hooks/inbox/useDeleteNote";
import { ROLE_RANK } from "@/lib/auth/types";
import { useT } from "@/hooks/i18n/useT";
import { Button } from "@/components/ui/button";
import { Composer } from "./Composer";
import { NoteCard } from "./NoteCard";

/** Observações internas pertencem à conversa, não ao fio enviado ao cliente. */
export function ConversationNotesPanel({
  conversationId,
  readonly,
}: {
  conversationId: string;
  readonly: boolean;
}) {
  const t = useT();
  const canView = usePermission("inbox.notes.view");
  const org = useActiveOrg();
  const user = useUser();
  const query = useConversationNotesQuery(canView ? conversationId : null);
  const deletion = useDeleteNote(conversationId);
  const [showAll, setShowAll] = useState(false);
  const [writing, setWriting] = useState(false);
  const notes = useMemo(
    () =>
      [...(query.data ?? [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      ),
    [query.data],
  );
  const visibleNotes = showAll ? notes : notes.slice(0, 2);
  const canManage = org != null && ROLE_RANK[org.role] >= ROLE_RANK.manager;

  if (!canView) return null;

  return (
    <section
      aria-label={t("Observações internas")}
      data-testid="inbox-observacoes"
      className="space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("Observações")}</h3>
        <span className="text-xs text-muted-foreground">{t("Só a equipe vê")}</span>
      </div>
      {query.isPending ? (
        <p role="status" className="text-xs text-muted-foreground">
          {t("Carregando observações…")}
        </p>
      ) : query.isError ? (
        <div className="space-y-2 text-xs">
          <p role="alert">{t("Não foi possível carregar as observações.")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : notes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("Nenhuma observação nesta conversa.")}</p>
      ) : (
        <ul className="space-y-2">
          {visibleNotes.map((note) => (
            <li key={note.id}>
              <NoteCard
                note={note}
                compact
                onDelete={
                  !readonly && (note.created_by_user_id === user.id || canManage)
                    ? () => deletion.mutate(note.id)
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        {!readonly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-0 flex-1"
            aria-expanded={writing}
            onClick={() => setWriting((current) => !current)}
          >
            {writing ? t("Fechar editor") : t("Nova observação")}
          </Button>
        )}
        {notes.length > 2 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-w-0 flex-1"
            aria-expanded={showAll}
            onClick={() => setShowAll((current) => !current)}
          >
            {showAll ? t("Ver menos") : t("Ver todas")}
          </Button>
        )}
      </div>
      {writing && !readonly && (
        <div className="overflow-hidden rounded-md border border-border">
          <Composer
            key={conversationId}
            conversationId={conversationId}
            fixedMode="note"
            active={false}
          />
        </div>
      )}
    </section>
  );
}
