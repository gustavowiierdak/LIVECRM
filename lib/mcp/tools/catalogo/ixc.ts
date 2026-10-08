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
      "Confere contratos e situação operacional do cliente desta conversa no IXC após validar seu CPF confirmado.",
    oQueToca: "Contratos do assinante",
    risco: "seguro",
    pacotes: ["atender"],
  },
]);
