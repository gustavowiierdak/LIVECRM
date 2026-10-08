---
impacto: capacidade_nova
secao: corrigido
titulo: Consulta Bemobi aceita fatura sem uniqueId
---

O teste e a consulta de faturas da Bemobi agora aceitam `uniqueId` nulo. A identificação usada para buscar PIX, boleto, PDF ou link passa a ser `erpInvoiceId`, conforme o contrato da API, e continua conferida no CPF do contato antes do envio.
