import { declararTools } from "./tipos";

export const TOOLS_IXC = declararTools([
  {
    name: "crm_get_ixc_customer",
    category: "read",
    rotulo: "Consultar cliente no IXC",
    explicacao:
      "Confere o cadastro operacional do cliente desta conversa no IXC após validar seu CPF confirmado.",
    oQueToca: "Cadastro do assinante",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_list_ixc_contracts",
    category: "read",
    rotulo: "Consultar contratos no IXC",
    explicacao:
      "Confere contratos, situação de acesso e bloqueio financeiro do cliente desta conversa no IXC após validar seu CPF confirmado.",
    oQueToca: "Contratos do assinante",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_request_ixc_trust_unlock",
    category: "write",
    rotulo: "Fazer desbloqueio de confiança",
    explicacao:
      "Libera temporariamente no IXC um contrato com bloqueio financeiro, somente depois da confirmação explícita do cliente.",
    oQueToca: "Acesso do contrato do assinante",
    risco: "atencao",
    // A ação financeira excepcional não entra no pacote genérico Atender,
    // que já ocupa o teto de ferramentas. O blueprint do Suporte a recebe
    // explicitamente; Retenção também pode habilitá-la quando fizer sentido.
    pacotes: ["reter"],
  },
]);
