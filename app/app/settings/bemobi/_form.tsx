"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  desconectarBemobi,
  salvarConexaoBemobi,
  testarConexaoBemobiSalva,
  type BemobiResources,
} from "@/app/actions/settings/updateBemobiConnection";
import { provisionarAgentesDoProvedor } from "@/app/actions/settings/provisionProviderAgents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

export interface BemobiConnectionView {
  enabled: boolean;
  resources: BemobiResources;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

const ERROS: Record<string, string> = {
  validation_failed: "Informe a chave da API na primeira conexão.",
  invalid_document: "Informe um CPF com 11 dígitos ou CNPJ com 14 dígitos para testar.",
  invalid_invoice: "A identificação da fatura é inválida.",
  unauthenticated: "Sua sessão expirou. Entre novamente.",
  forbidden_tenant: "Você não está em uma empresa ativa.",
  forbidden_role: "Só um administrador da empresa pode alterar esta conexão.",
  mfa_required: "Confirme a verificação em duas etapas para continuar.",
  cifra_indisponivel: "A chave mestra de criptografia desta instalação não está configurada.",
  credencial_indisponivel: "As credenciais guardadas não puderam ser lidas. Salve novas credenciais.",
  secret_required: "O checkout exige também o segredo da API.",
  not_configured: "Salve a conexão antes de testá-la.",
  disabled: "Ative a integração antes de testá-la.",
  unauthorized: "A Bemobi recusou a chave ou as permissões dessa integração.",
  not_found: "A Bemobi não encontrou o recurso solicitado.",
  timeout: "A Bemobi não respondeu em 10 segundos.",
  connection_failed: "Não foi possível alcançar a API da Bemobi.",
  unexpected_response: "A Bemobi respondeu em um formato diferente do esperado.",
  erro_ao_gravar: "Não foi possível gravar a conexão agora.",
};

const OPCOES: Array<{ key: keyof BemobiResources; label: string; detail: string }> = [
  { key: "invoices", label: "Faturas", detail: "Valores, vencimentos e situação" },
  { key: "payment_data", label: "PIX e boleto", detail: "Dados de pagamento da fatura" },
  { key: "invoice_pdf", label: "Segunda via em PDF", detail: "Documento oficial da cobrança" },
  { key: "secure_portal", label: "Portal do assinante", detail: "Link seguro de autoatendimento" },
  { key: "negotiation", label: "Negociação", detail: "Consulta e execução de acordos" },
  { key: "recurrence", label: "Recorrência", detail: "Cadastro de pagamento recorrente" },
  { key: "checkout", label: "Checkout", detail: "Sessão de pagamento com chave e segredo" },
];

const PADRAO: BemobiResources = {
  invoices: true,
  payment_data: true,
  invoice_pdf: true,
  secure_portal: true,
  negotiation: false,
  recurrence: false,
  checkout: false,
};

export function BemobiConnectionForm({
  initial,
  teamCount,
}: {
  initial: BemobiConnectionView | null;
  teamCount: number;
}) {
  const t = useT();
  const tagDoIdioma = useTagDeIdioma();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [documentoTeste, setDocumentoTeste] = useState("");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [resources, setResources] = useState<BemobiResources>(initial?.resources ?? PADRAO);

  const conectada = initial !== null;
  const podeSalvar = conectada || apiKey.trim().length >= 8;

  function mensagem(error: string, detalhada?: string) {
    return detalhada || ERROS[error] || "Não foi possível concluir agora.";
  }

  function salvar(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await salvarConexaoBemobi({
        api_key: apiKey.trim() || undefined,
        api_secret: apiSecret.trim() || undefined,
        enabled,
        resources,
      });
      if (!result.ok) {
        toast.error(t(mensagem(result.error, result.message)));
        return;
      }
      setApiKey("");
      setApiSecret("");
      toast.success(t("Conexão da Bemobi salva."));
      router.refresh();
    });
  }

  function testar() {
    startTransition(async () => {
      const result = await testarConexaoBemobiSalva({ document: documentoTeste });
      if (!result.ok) {
        toast.error(t(mensagem(result.error, result.message)));
        router.refresh();
        return;
      }
      toast.success(
        `${t("Conexão confirmada.")} ${result.total ?? 0} ${t("fatura(s) encontrada(s) para o documento de teste.")}`,
      );
      setDocumentoTeste("");
      router.refresh();
    });
  }

  function desconectar() {
    if (!window.confirm(t("Desconectar a Bemobi e apagar as credenciais guardadas?"))) return;
    startTransition(async () => {
      const result = await desconectarBemobi();
      if (!result.ok) {
        toast.error(t(mensagem(result.error, result.message)));
        return;
      }
      setApiKey("");
      setApiSecret("");
      toast.success(t("Bemobi desconectada."));
      router.refresh();
    });
  }

  function criarEquipe() {
    startTransition(async () => {
      const result = await provisionarAgentesDoProvedor();
      if (!result.ok) {
        toast.error(
          result.error === "model_not_available"
            ? t("Nenhum modelo com ferramentas está disponível para o provedor de IA da empresa.")
            : t("Não foi possível criar a equipe de agentes."),
        );
        return;
      }
      toast.success(
        result.created > 0
          ? `${result.created} ${t("agente(s) criado(s) em rascunho para revisão.")}`
          : t("A equipe de agentes já estava criada."),
      );
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
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">{t("Endpoint oficial:")} </span>
              <code>https://api.7az.com.br</code>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bemobi_api_key">{t("Chave da API")}</Label>
              <Input
                id="bemobi_api_key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={conectada ? t("Guardada — preencha somente para trocar") : "X-API-Key"}
                autoComplete="new-password"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bemobi_api_secret">{t("Segredo da API")}</Label>
              <Input
                id="bemobi_api_secret"
                type="password"
                value={apiSecret}
                onChange={(event) => setApiSecret(event.target.value)}
                placeholder={conectada ? t("Guardado — preencha somente para trocar") : "X-API-Secret"}
                autoComplete="new-password"
              />
              <p className="text-xs text-muted-foreground">
                {t("Necessário apenas para o checkout. As consultas de fatura usam a chave da API.")}
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div>
                <Label htmlFor="bemobi_enabled">{t("Integração ativa")}</Label>
                <p className="text-xs text-muted-foreground">
                  {t("Desative para impedir consultas futuras sem apagar a configuração.")}
                </p>
              </div>
              <Switch id="bemobi_enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isPending || !podeSalvar}>
                {isPending ? t("Aguarde…") : t("Salvar conexão")}
              </Button>
              {conectada && (
                <Button type="button" variant="ghost" disabled={isPending} onClick={desconectar}>
                  {t("Desconectar")}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("Recursos autorizados")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {OPCOES.map((opcao) => (
            <div key={opcao.key} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor={`bemobi_${opcao.key}`}>{t(opcao.label)}</Label>
                <p className="text-xs text-muted-foreground">{t(opcao.detail)}</p>
              </div>
              <Switch
                id={`bemobi_${opcao.key}`}
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
          <CardHeader>
            <CardTitle>{t("Testar sem salvar o documento")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bemobi_test_document">{t("CPF ou CNPJ de um cliente para o teste")}</Label>
              <Input
                id="bemobi_test_document"
                value={documentoTeste}
                onChange={(event) => setDocumentoTeste(event.target.value)}
                placeholder="000.000.000-00"
                inputMode="numeric"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                {t("O documento é enviado diretamente à Bemobi e não fica salvo no CRM nem na auditoria.")}
              </p>
            </div>
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={isPending || documentoTeste.replace(/\D/g, "").length < 11}
                onClick={testar}
              >
                {t("Testar conexão")}
              </Button>
            </div>
            {initial.lastTestedAt === null ? (
              <p className="text-sm text-muted-foreground">{t("A conexão ainda não foi testada.")}</p>
            ) : initial.lastTestOk ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                {t("Último teste concluído com sucesso em")} {new Date(initial.lastTestedAt).toLocaleString(tagDoIdioma)}.
              </p>
            ) : (
              <p role="alert" className="text-sm text-destructive">
                {t("O último teste falhou:")} {initial.lastTestError || t("falha sem detalhe")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("Equipe de atendimento do provedor")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {t("Cria cinco agentes em rascunho: Recepção e Triagem, Financeiro, Suporte Técnico, Comercial e Relacionamento e Contratos. Também prepara um roteador desligado para você revisar antes de publicar.")}
          </p>
          <div className="rounded-md border p-3">
            {teamCount > 0
              ? `${teamCount} ${t("de 5 agentes desta equipe já estão criados.")}`
              : t("Nenhum agente desta equipe foi criado ainda.")}
          </div>
          <div>
            <Button type="button" variant="outline" disabled={isPending} onClick={criarEquipe}>
              {teamCount >= 5 ? t("Conferir e completar equipe") : t("Criar equipe em rascunho")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("O envio de PIX e boleto é uma capacidade crítica e não nasce ligado automaticamente. Ative-a manualmente no agente Financeiro depois de testar a conexão.")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
