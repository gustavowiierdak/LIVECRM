import { declararTools } from "./tipos";

export const TOOLS_BEMOBI = declararTools([
  {
    name: "crm_list_bemobi_invoices",
    category: "read",
    rotulo: "Consultar faturas na Bemobi",
    explicacao:
      "Confere as cobranças do cliente atual na Bemobi depois que o CPF dele coincide com o documento já confirmado no cadastro.",
    oQueToca: "Faturas do assinante",
    risco: "seguro",
    pacotes: ["atender"],
  },
  {
    name: "crm_send_bemobi_payment",
    category: "write",
    rotulo: "Enviar PIX, boleto ou segunda via",
    explicacao:
      "Busca o meio de pagamento diretamente na Bemobi e envia ao cliente real sem mostrar o código financeiro para a IA.",
    oQueToca: "Pagamento do assinante",
    risco: "critico",
    pacotes: ["atender"],
  },
]);
