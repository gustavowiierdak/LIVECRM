"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { VinculoIxcDoContato } from "@/lib/ixc/vinculo-do-contato";
import { CheckCircle, IdentificationCard } from "@/lib/ui/icons";

interface Props {
  contactId: string;
  readonly: boolean;
  initialLink: VinculoIxcDoContato | null;
}

function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "").slice(0, 11);
}

export function VinculoIxcDoContato({ contactId, readonly, initialLink }: Props) {
  const t = useT();
  const [vinculoSalvo, setVinculoSalvo] = useState<{
    contactId: string;
    vinculo: VinculoIxcDoContato;
  } | null>(null);
  const [aberto, setAberto] = useState(false);
  const [documento, setDocumento] = useState("");
  const [salvando, setSalvando] = useState(false);
  const vinculo = vinculoSalvo?.contactId === contactId ? vinculoSalvo.vinculo : initialLink;

  function fechar() {
    if (salvando) return;
    setAberto(false);
    setDocumento("");
  }

  async function salvar() {
    const cpf = soDigitos(documento);
    if (cpf.length !== 11) return;
    setSalvando(true);
    try {
      const resposta = await apiClient.post<{ data: VinculoIxcDoContato }>(
        `/api/v1/contacts/${contactId}/ixc-link`,
        { document: cpf },
      );
      setVinculoSalvo({ contactId, vinculo: resposta.data });
      setAberto(false);
      setDocumento("");
      toast.success(t("Cadastro do IXC vinculado ao contato."));
    } catch {
      toast.error(t("Não foi possível vincular o cadastro. Confira o CPF e tente novamente."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="rounded-md border border-border bg-surface/40 p-2.5" data-testid="vinculo-ixc-contato">
        <div className="flex items-start gap-2">
          <IdentificationCard size={17} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              {t("Cadastro IXC")}
              {vinculo ? <CheckCircle size={13} weight="fill" className="text-success-fg" aria-hidden /> : null}
            </div>
            {vinculo ? (
              <>
                <div className="mt-1 wrap-anywhere text-xs font-medium">
                  <span className="tabular-nums">{vinculo.customer_id}</span>
                  <span aria-hidden> · </span>
                  {vinculo.customer_name}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {vinculo.linked_by === "automatico"
                    ? t("Vinculado automaticamente pelo CPF informado no atendimento.")
                    : t("Vinculado por um atendente.")}
                </div>
              </>
            ) : (
              <div className="mt-1 text-xs text-muted-foreground">
                {t("Nenhum cadastro do IXC vinculado.")}
              </div>
            )}
          </div>
        </div>
        {!readonly ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-7 w-full text-xs"
            onClick={() => setAberto(true)}
          >
            {vinculo ? t("Alterar vínculo") : t("Vincular cadastro do IXC")}
          </Button>
        ) : null}
      </div>

      <Dialog open={aberto} onOpenChange={(open) => (open ? setAberto(true) : fechar())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{vinculo ? t("Alterar cadastro do IXC") : t("Vincular cadastro do IXC")}</DialogTitle>
            <DialogDescription>
              {t("Informe o CPF do titular. O cadastro encontrado no IXC ficará visível neste contato.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`ixc-document-${contactId}`}>{t("CPF do titular")}</Label>
            <Input
              id={`ixc-document-${contactId}`}
              value={documento}
              onChange={(event) => setDocumento(soDigitos(event.target.value))}
              inputMode="numeric"
              autoComplete="off"
              placeholder="00000000000"
              aria-describedby={`ixc-document-help-${contactId}`}
              disabled={salvando}
            />
            <p id={`ixc-document-help-${contactId}`} className="text-xs text-muted-foreground">
              {t("A busca é exata e não altera o nome recebido pelo canal.")}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={fechar} disabled={salvando}>
              {t("Cancelar")}
            </Button>
            <Button type="button" onClick={() => void salvar()} disabled={soDigitos(documento).length !== 11 || salvando}>
              {salvando ? t("Consultando…") : t("Consultar e vincular")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
