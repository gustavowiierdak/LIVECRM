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

Troca de abas Fechadas/Todas (seis cliques):
2082, 1463, 1110, 1055, 1175, 946 ms. Mediana: 1142,5 ms.

## Gargalos confirmados no código

- Webchat: conversa → sessões → mensagens, com autenticação repetida entre
  requisições. A troca descartava o histórico e repetia toda a sequência.
- Detalhe da conversa chamava `getUser` e depois `loadAuthUser`, que já chama
  `getUser` para validar a mesma sessão.
- Ficha aguardava enriquecimento antes de disparar seis consultas independentes.
- Trocar apenas o filtro disparava navegação RSC, refazendo layout/autenticação
  no servidor. Agora usa History API, mantendo URL e consultas autorizadas.

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

## Resultado publicado

Código e imagem em produção: `f1afaa237d0decb25f5a46597edf2b7abf50e0d4`.
Build publicado com sucesso: Actions run `38662230846`. Atualização pelo kit,
com backup do banco, sessões e anexos, checagem de saúde e crons confirmados.
61 testes focados passaram; typecheck passou. Não foi executada a suíte completa.
Os testes de regressão do cache e do filtro também falharam quando suas respectivas
correções foram temporariamente removidas, e passaram após restauração.

Primeiro acesso após deploy: lista 5774 ms, histórico/ficha/contadores 7209 ms.
Esse acesso aquece a aplicação e fica separado da comparação aquecida.

| Amostra após | Lista pronta (ms) | Histórico pronto (ms) | Histórico + ficha + contadores (ms) |
| --- | ---: | ---: | ---: |
| 1 | 2952 | 4389 | 4389 |
| 2 | 4099 | 5688 | 5688 |
| 3 | 3506 | 4619 | 4619 |
| 4 | 3495 | 5061 | 5061 |

Trocas entre os mesmos atendimentos: 1609, 426, 425, 425, 419, 411 ms.
A primeira entrada no segundo atendimento ainda busca os dados; as demais
reutilizam os dados em memória e revalidam em segundo plano. Não é uma promessa
de que a leitura atualizada no servidor terminou em 425 ms.

Trocas entre Fechadas/Todas: 978, 407, 414, 416, 417, 420 ms.

| Mediana | Antes (ms) | Depois (ms) | Leitura |
| --- | ---: | ---: | --- |
| Lista após recarregar | 2967,5 | 3500,5 | 18% mais lenta nesta amostra; sem ganho comprovado |
| Histórico + ficha + contadores | 5001 | 4840 | 3,2% menor; diferença pequena, não conclusiva |
| Alternância entre conversas | 1653 | 425 | 74,3% menos espera, graças ao cache de retorno |
| Alternância entre abas | 1142,5 | 416,5 | 63,5% menos espera |

Nenhum erro de console foi observado após as verificações na versão nova.

## Diagnóstico restante

A otimização da navegação não resolve o primeiro carregamento. Prioridades
para a próxima rodada, com instrumentação de tempos antes de novas mudanças:

1. Medir separadamente renderização autenticada inicial, hidratação e leituras
   iniciais de lista/detalhe/ficha. Não remover controles de acesso para ganhar tempo.
2. Avaliar consultas/contadores da Inbox com planos executados sob a mesma RLS.
   `pg_stat_statements` já estava habilitado: algumas consultas de lista/contagem
   têm médias históricas de 106–166 ms; uma contagem frequente tem média de 31 ms.
   São estatísticas acumuladas, não tempos isolados desta navegação. Não havia
   custo JIT nas três consultas inspecionadas. Não foram criados índices nem
   alteradas policies com base apenas nesses números.
3. Avaliar divisão do dicionário de idiomas e de módulos não usados na abertura:
   o dicionário é importado estaticamente no cliente mesmo em português. Reduzir
   bytes precisa preservar traduções, SSR e troca de idioma; não foi alterado aqui.

Na amostra adicional do host: 8 CPUs, load de 1,13/1,32/1,32, ~12,5 GiB de RAM
disponível e zero swap usado. Banco consumiu ~110% de uma CPU num instante;
isso não caracteriza saturação das 8 CPUs. Disco em 88% antes deste deploy:
requer planejamento de capacidade/retenção, sem limpeza manual nesta tarefa.
