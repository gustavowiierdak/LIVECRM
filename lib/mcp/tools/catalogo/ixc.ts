import { declararTools } from "./tipos";

export const TOOLS_IXC = declararTools([
  {
    name: "crm_watch_ixc_service_order",
    category: "write",
    rotulo: "Acompanhar O.S. e avisar o cliente",
    explicacao:
      "Acompanha a ordem escolhida no atendimento e avisa mudanças de agenda e finalização, aguardando a confirmação da solução.",
    oQueToca: "Acompanhamento do atendimento",
    risco: "atencao",
    pacotes: ["reter"],
  },
  {
    name: "crm_get_ixc_diagnostics",
    category: "read",
    rotulo: "Consultar conexão e sinal no IXC",
    explicacao:
      "Consulta o estado de conexão e as últimas medições de sinal do contrato escolhido, sem expor credenciais.",
    oQueToca: "Diagnóstico do assinante",
    risco: "seguro",
    pacotes: ["reter"],
  },
  {
    name: "crm_list_ixc_service_orders",
    category: "read",
    rotulo: "Consultar O.S. e agendamento",
    explicacao:
      "Consulta as ordens de serviço e os horários registrados no IXC para o contrato escolhido pelo cliente.",
    oQueToca: "Ordens de serviço",
    risco: "seguro",
    pacotes: ["reter"],
  },
  {
    name: "crm_check_ixc_payment",
    category: "read",
    rotulo: "Conferir baixa e acesso no IXC",
    explicacao:
      "Confere se uma fatura foi recebida no IXC e se o contrato permanece bloqueado, sem efetuar baixa manual.",
    oQueToca: "Pagamento e acesso do assinante",
    risco: "seguro",
    pacotes: ["reter"],
  },
  {
    name: "crm_create_ixc_service_order",
    category: "write",
    rotulo: "Abrir O.S. de suporte no IXC",
    explicacao:
      "Abre uma ordem de serviço após confirmação do cliente, com assunto e setor configurados e proteção contra duplicação.",
    oQueToca: "Ordens de serviço",
    risco: "atencao",
    pacotes: ["reter"],
  },
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
