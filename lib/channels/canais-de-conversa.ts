import { SOCIAL_NETWORKS } from "./social/catalog";

/**
 * O QUE PODE SER GRAVADO EM `conversations.channel`.
 *
 * ## O defeito que este arquivo fecha
 *
 * Duas listas precisavam concordar e nada as ligava:
 *
 *   1. `SOCIAL_NETWORKS[].inbox` — em TypeScript, decide se uma rede pode ter
 *      atendimento no CRM. Hoje: Instagram e Facebook.
 *   2. `conversations_channel_check` — no banco, decide o que a coluna aceita.
 *
 * `lib/channels/zernio/ingest.ts` grava a plataforma **crua** na coluna
 * (`.update({ channel: input.socialMessage.platform })`). Marcar `inbox: true`
 * numa rede nova — uma linha, plausível, sem nada avisando — passava por toda a
 * validação de TypeScript e morria no INSERT com `23514`.
 *
 * E o modo de falha é o pior: o webhook do provedor **reentrega**. Cada
 * reentrega dá 500 de novo, para sempre, sem ninguém do lado de cá sabendo por
 * quê — a tela de Conexões mostra a conta ligada e a conversa nunca aparece.
 *
 * ## Por que DERIVAR em vez de escrever a lista
 *
 * Escrever as redes sociais aqui criaria uma TERCEIRA lista para manter em
 * sincronia — o defeito que este arquivo existe para matar, uma camada acima.
 * Derivando do catálogo, marcar `inbox: true` numa rede nova muda ESTE símbolo,
 * e o invariante de banco reprova até que a migration correspondente acrescente
 * o valor ao CHECK.
 *
 * Ou seja: a divergência deixa de ser possível em silêncio. Ou as duas listas
 * andam juntas, ou o CI reprova.
 *
 * ## Canais próprios não vêm do catálogo social
 *
 * WhatsApp usa WAHA/Meta; webchat usa a sessão HTTP própria. Nenhum deles passa
 * pelo intermediário social, por isso ambos ficam explícitos aqui.
 */
export const CANAIS_DE_CONVERSA = [
  "whatsapp",
  "webchat",
  ...SOCIAL_NETWORKS.filter((rede) => rede.inbox).map((rede) => rede.id),
] as const satisfies readonly string[];

export type CanalDeConversa = (typeof CANAIS_DE_CONVERSA)[number];

/**
 * `true` quando este valor pode ir para `conversations.channel`.
 *
 * Aceita `string` de propósito: quem chama está com um valor vindo do
 * provedor externo, não de um tipo nosso.
 */
export function ehCanalDeConversa(valor: string | null | undefined): boolean {
  return typeof valor === "string" && (CANAIS_DE_CONVERSA as readonly string[]).includes(valor);
}
