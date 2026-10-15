# Medição da Inbox — 14/10/2026

## Método

Produção `crm.liveinternet.com.br`, Chrome neste Mac, mesma sessão autenticada,
filtro Todas (4 conversas) e mesmo atendimento web encerrado. Tempos de parede
medidos da chamada de recarregar/clicar até o conteúdo estar presente no DOM.
Incluem a pequena sobrecarga da automação; não são métricas do Performance API.
Não foi enviado texto a clientes nem alterado o estado dos atendimentos.

Baseline: `ed8f2ee1b`. Quatro recarregamentos válidos após aquecimento. Uma
tentativa com seletor incorreto e uma com timeout da ferramenta foram excluídas;
não se deve interpretar esta amostra pequena como p95 ou teste de carga.

| Amostra | Lista pronta (ms) | Histórico pronto (ms) | Histórico + ficha + contadores (ms) |
| --- | ---: | ---: | ---: |
| 1 | 3063 | 5879 | 5907 |
| 2 | 3159 | 5169 | 5169 |
| 3 | 2872 | 4833 | 4833 |
| 4 | 2692 | 4571 | 4571 |

Troca entre dois atendimentos web já abertos (seis cliques):
1949, 1665, 1641, 1514, 1533, 1677 ms. Mediana: 1653 ms.

## Gargalos confirmados no código

- Webchat: conversa → sessões → mensagens, com autenticação repetida entre
  requisições. A troca descartava o histórico e repetia toda a sequência.
- Detalhe da conversa chamava `getUser` e depois `loadAuthUser`, que já chama
  `getUser` para validar a mesma sessão.
- Ficha aguardava enriquecimento antes de disparar seis consultas independentes.

## Infraestrutura

App saudável, ~292 MiB de 768 MiB, sem throttling de CPU no cgroup. Supabase na
mesma VPS. O domínio público já resolve pelo Caddy interno. A comparação de
transporte não justificou mudar a rede: leituras aquecidas via domínio ficaram
em 10–20 ms e via gateway interno em 8–14 ms (respostas 401 sem dados, apenas
sonda de transporte; não é medida de consulta autenticada). Nenhuma mudança
de segurança, recurso de servidor ou rede foi aplicada.

## Limites

Não compara desempenho do OPA (aba sem sessão autenticada), redes móveis,
centenas de atendimentos simultâneos, envio de WhatsApp ou latência do modelo
de IA/IXC. A comparação de ganho após publicação usa os mesmos critérios acima.
