"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  desconectarIxc,
  salvarConexaoIxc,
  testarConexaoIxcSalva,
  type IxcResources,
} from "@/app/actions/settings/updateIxcConnection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

export interface IxcConnectionView {
  baseUrl: string;
  enabled: boolean;
  resources: IxcResources;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

const ERROS: Record<string, string> = {
  validation_failed: "Confira a URL e informe o token na primeira conexão.",
  invalid_url: "Use somente a origem HTTPS do IXC, sem /webservice, parâmetros ou caminho.",
  unsafe_destination: "O endereço precisa apontar para um servidor público seguro.",
  unauthenticated: "Sua sessão expirou. Entre novamente.",
  forbidden_tenant: "Você não está em uma empresa ativa.",
  forbidden_role: "Só um administrador da empresa pode alterar esta conexão.",
  mfa_required: "Confirme a verificação em duas etapas para continuar.",
  cifra_indisponivel: "A chave mestra de criptografia desta instalação não está configurada.",
  credencial_indisponivel: "O token guardado não pôde ser lido. Salve um novo token.",
  not_configured: "Salve a conexão antes de testá-la.",
  unauthorized: "O IXC recusou o token ou as permissões desse usuário.",
  timeout: "O IXC não respondeu em 10 segundos.",
  connection_failed: "Não foi possível alcançar a API do IXC.",
  unexpected_response: "O endereço respondeu, mas não parece ser a API do IXC.",
  erro_ao_gravar: "Não foi possível gravar a conexão agora.",
};

const OPCOES: Array<{ key: keyof IxcResources; label: string; detail: string }> = [
  { key: "customers", label: "Clientes", detail: "Cadastro e situação do assinante" },
  { key: "contracts", label: "Contratos", detail: "Planos e situação dos contratos" },
  { key: "receivables", label: "Financeiro", detail: "Títulos e situação de pagamento" },
  { key: "service_orders", label: "Ordens de serviço", detail: "Chamados e atendimentos técnicos" },
];

export function IxcConnectionForm({ initial }: { initial: IxcConnectionView | null }) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [resources, setResources] = useState<IxcResources>(
    initial?.resources ?? {
      customers: true,
      contracts: true,
      receivables: true,
      service_orders: true,
    },
  );

  const conectada = initial !== null;
  const podeSalvar = baseUrl.trim().length > 0 && (conectada || token.trim().length >= 3);

  function mensagem(error: string, detalhada?: string) {
    return detalhada || ERROS[error] || "Não foi possível concluir agora.";
  }

  function salvar(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await salvarConexaoIxc({
        base_url: baseUrl,
        token: token.trim() || undefined,
        enabled,
        resources,
      });
      if (!result.ok) {
        toast.error(t(mensagem(result.error, result.message)));
        return;
      }
      setToken("");
      toast.success(t("Conexão do IXC salva."));
      router.refresh();
    });
  }

  function testar() {
    startTransition(async () => {
      const result = await testarConexaoIxcSalva();
      if (!result.ok) {
        toast.error(t(mensagem(result.error, result.message)));
        router.refresh();
        return;
      }
      toast.success(
        result.total === null
          ? t("Conexão com o IXC confirmada.")
          : `${t("Conexão confirmada.")} ${result.total} ${t("cliente(s) informado(s) pelo IXC.")}`,
      );
      router.refresh();
    });
  }

  function desconectar() {
    if (!window.confirm(t("Desconectar o IXC e apagar o token guardado?"))) return;
    startTransition(async () => {
      const result = await desconectarIxc();
      if (!result.ok) {
        toast.error(t(mensagem(result.error, result.message)));
        return;
      }
      setBaseUrl("");
      setToken("");
      toast.success(t("IXC desconectado."));
      router.refresh();
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-4">
            <span>{t("Dados de acesso")}</span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                conectada
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {conectada ? t("Conectado") : t("Não configurado")}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={salvar} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ixc_base_url">{t("URL do seu IXC")}</Label>
              <Input
                id="ixc_base_url"
                type="url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="https://seu-provedor.example"
                autoComplete="url"
              />
              <p className="text-xs text-muted-foreground">
                {t("Informe só o endereço principal, sem")} <code>/webservice/v1</code>{" "}
                {t("e sem barra final.")}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ixc_token">{t("Token do webservice")}</Label>
              <Input
                id="ixc_token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={conectada ? t("Guardado — preencha somente para trocar") : "6:..."}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                {conectada
                  ? t("O token já está criptografado. Deixe em branco para mantê-lo.")
                  : t("Cole o token completo gerado para o usuário do webservice.")}
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div>
                <Label htmlFor="ixc_enabled">{t("Integração ativa")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("Desative para impedir consultas futuras sem apagar a configuração.")}
                </p>
              </div>
              <Switch id="ixc_enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isPending || !podeSalvar}>
                {isPending ? t("Aguarde…") : t("Salvar conexão")}
              </Button>
              {conectada && (
                <>
                  <Button type="button" variant="outline" disabled={isPending} onClick={testar}>
                    {t("Testar conexão")}
                  </Button>
                  <Button type="button" variant="ghost" disabled={isPending} onClick={desconectar}>
                    {t("Desconectar")}
                  </Button>
                </>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Dados que poderão ser usados")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {OPCOES.map((opcao) => (
            <div key={opcao.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor={`ixc_${opcao.key}`}>{t(opcao.label)}</Label>
                <p className="text-xs text-muted-foreground">{t(opcao.detail)}</p>
              </div>
              <Switch
                id={`ixc_${opcao.key}`}
                checked={resources[opcao.key]}
                onCheckedChange={(checked) =>
                  setResources((atual) => ({ ...atual, [opcao.key]: checked }))
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {conectada && (
        <Card>
          <CardContent className="pt-6 text-sm">
            {initial.lastTestedAt === null ? (
              <p className="text-muted-foreground">{t("A conexão ainda não foi testada.")}</p>
            ) : initial.lastTestOk ? (
              <p className="text-emerald-700 dark:text-emerald-300">
                {t("Último teste concluído com sucesso em")} {new Date(initial.lastTestedAt).toLocaleString(tagDoIdioma)}.
              </p>
            ) : (
              <p role="alert" className="text-destructive">
                {t("O último teste falhou:")} {initial.lastTestError || t("falha sem detalhe")}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
