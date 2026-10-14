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
  compact?: boolean;
}

function soDigitos(valor: string): string {
  return valor.replace(/\D/g, "").slice(0, 14);
}

export function VinculoIxcDoContato(props: Props) {
  return <FormularioVinculoIxc key={props.contactId} {...props} />;
}

function FormularioVinculoIxc({ contactId, readonly, initialLink, compact = false }: Props) {
  const t = useT();
  const [vinculoSalvo, setVinculoSalvo] = useState<{
    contactId: string;
    vinculo: VinculoIxcDoContato;
  } | null>(null);
  const [aberto, setAberto] = useState(false);
  const [documento, setDocumento] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [opcoes, setOpcoes] = useState<{ id: string; nome: string }[]>([]);
  const vinculo = vinculoSalvo?.contactId === contactId ? vinculoSalvo.vinculo : initialLink;

  function fechar() {
    if (salvando) return;
    setAberto(false);
    setDocumento("");
    setOpcoes([]);
  }

  async function salvar(customerId?: string) {
    const cpf = soDigitos(documento);
    if (cpf.length !== 11 && cpf.length !== 14) return;
    setSalvando(true);
    try {
      const resposta = await apiClient.post<{
        data:
          | VinculoIxcDoContato
          | { selection_required: true; clientes: { id: string; nome: string }[] };
      }>(`/api/v1/contacts/${contactId}/ixc-link`, {
        document: cpf,
        ...(customerId ? { customer_id: customerId } : {}),
      });
      if ("selection_required" in resposta.data) {
        setOpcoes(resposta.data.clientes);
        return;
      }
      setVinculoSalvo({ contactId, vinculo: resposta.data });
      setAberto(false);
      setDocumento("");
      setOpcoes([]);
      toast.success(t("Cadastro do IXC vinculado ao contato."));
    } catch {
      toast.error(t("Não foi possível vincular o cadastro. Confira o CPF/CNPJ e tente novamente."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div
        className={compact ? "crm-contact-ixc text-center" : "rounded-md border border-border bg-surface/40 p-2.5"}
        data-testid="vinculo-ixc-contato"
      >
        <div className={compact ? "flex flex-col items-center gap-1" : "flex items-start gap-2"}>
          <IdentificationCard
            size={17}
            className={compact ? "hidden" : "mt-0.5 shrink-0 text-muted-foreground"}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <div className={`flex items-center gap-1.5 text-xs font-medium ${compact ? "justify-center text-muted-foreground" : ""}`}>
              {t("Cadastro IXC")}
              {vinculo ? (
                <CheckCircle size={13} weight="fill" className="text-success-fg" aria-hidden />
              ) : null}
            </div>
            {vinculo ? (
              <>
                <div className="mt-1 text-xs font-medium wrap-anywhere">
                  <span className="tabular-nums">{vinculo.customer_id}</span>
                  <span aria-hidden> · </span>
                  {vinculo.customer_name}
                </div>
                <div className={compact ? "sr-only" : "mt-0.5 text-[11px] text-muted-foreground"}>
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
            <DialogTitle>
              {vinculo ? t("Alterar cadastro do IXC") : t("Vincular cadastro do IXC")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "Informe o CPF ou CNPJ do titular. Se houver vários cadastros, escolha o correto antes de vincular.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`ixc-document-${contactId}`}>{t("CPF/CNPJ do titular")}</Label>
            <Input
              id={`ixc-document-${contactId}`}
              value={documento}
              onChange={(event) => {
                setDocumento(soDigitos(event.target.value));
                setOpcoes([]);
              }}
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
          {opcoes.length > 0 ? (
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm">{t("Selecione o cadastro correto:")}</p>
              {opcoes.map((opcao) => (
                <Button
                  key={opcao.id}
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start text-left whitespace-normal"
                  disabled={salvando}
                  onClick={() => void salvar(opcao.id)}
                >
                  {opcao.id} · {opcao.nome}
                </Button>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={fechar} disabled={salvando}>
              {t("Cancelar")}
            </Button>
            <Button
              type="button"
              onClick={() => void salvar()}
              disabled={
                ![11, 14].includes(soDigitos(documento).length) || salvando || opcoes.length > 0
              }
            >
              {salvando ? t("Consultando…") : t("Consultar e vincular")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
