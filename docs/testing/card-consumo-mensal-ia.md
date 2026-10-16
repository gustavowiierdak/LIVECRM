# Resumo de consumo mensal da IA

CONFIRMADO: `MonthlyUsageCard` na entrada `/app/ai` usa o mesmo `useAiBudget`
e GET `/api/v1/ai/budget` de Uso de IA. A medição é em centavos de USD, no mês
UTC corrente; não há conversão para reais. Não é o saldo da conta do provedor.

## Living System Checklist

- Entrada: `getBudgetStatus`, régua mensal existente, limitada à organização.
- Saída: gestor acompanha gasto e abre `/app/ai/usage` pela engrenagem.
- Atividade: nenhuma mutação nova; edições existentes mantêm auditoria do orçamento.
- Porta/tela: hub Agente de IA já registrado na navegação; apenas manager+ como a API.
- Anti-morte: falha explícita com nova tentativa; não confunde carregamento com zero.
- Configuração: orçamento já editável em Uso de IA por admin; sem limite mostra isso.
- Continuidade: não altera atendimento, handoff ou política de bloqueio.
- Retorno: medição parcial é sinalizada; gestor pode conferir provedor e ajustar orçamento.
- Mapa: `teto-de-orcamento.architecture.json`, entrada hook e saída para BudgetCard.

## Verificação

`tests/unit/monthly-usage-card.test.tsx` cobre moeda, porcentagem, acesso às
configurações, ausência de limite, excesso, preço desconhecido, carregamento e
erro com nova tentativa. Regressões: BudgetCard, medição, API, NavHub e mapas.
Consulta a cada 60 segundos somente com a aba visível, usando cache compartilhado.
