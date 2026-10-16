/**
 * GET /api/v1/conversations/counts — contagens por visão do inbox (G4-02).
 *
 * Usa o client user-scoped (cookie session) → toda contagem HERDA a RLS de
 * SELECT de `conversations` (fn_can_view_conversation, migration 0035). Um agent
 * em modo own* recebe a contagem do SEU escopo, NUNCA o total da org — a mesma
 * garantia do listing. Head count (count:'exact', head:true) não devolve linhas.
 */
import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { idsDosCanaisDesativados } from "@/lib/channels/desativado";
import { loadAuthUser } from "@/lib/auth/server";
import { orgAtivaDaApi } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { CONVERSATION_TERMINAL_STATUSES } from "@/lib/schemas";
import { orgTemAutomatico } from "@/lib/ai/agents/org-tem-automatico";
import { comandosDaFila } from "@/lib/inbox/comando-da-conversa";
import { aplicarMarcadores, modoDeEtiqueta } from "@/lib/inbox/marcador-da-conversa";
import { createClient } from "@/lib/supabase/server";
import { idsDeContatosPessoais } from "../_handler";

export const dynamic = "force-dynamic";

/** Um par pronto para virar predicado: coluna e valor. */
export type FiltroDeContagem = readonly [coluna: string, valor: string | boolean];

/**
 * Os filtros AUXILIARES que a lista aplicou e que a contagem tem de aplicar junto.
 *
 * ─── O defeito ─────────────────────────────────────────────────────────────
 * Medido na tela: com "Não lidos" ligado, a lista mostrava ZERO linhas e a aba
 * continuava estampando "Todas 2". Este próprio arquivo já declarava a regra —
 * "um badge que conta o que a aba não mostra manda o atendente procurar trabalho
 * que não existe" — e a regra estava certa: a COBERTURA parou no predicado da
 * aba e nunca alcançou os filtros ao lado dela.
 *
 * ─── Por que uma lista só, e não um `if` por contagem ──────────────────────
 * Uma lista aplicada a TODAS as contagens torna a divergência impossível por
 * construção: não existe o caminho "esqueci de pôr o filtro na contagem X".
 * `tests/unit/badge-espelha-o-filtro.test.ts` vigia que nenhuma contagem seja
 * montada por fora.
 *
 * A busca (`search`) NÃO entra: ela casa contato por uma consulta auxiliar em
 * `contacts`, e repetir aquela lógica aqui criaria uma SEGUNDA régua de busca —
 * e a segunda régua sempre diverge. Enquanto isso, o badge sob busca fica maior
 * que a lista, e isso está declarado, não esquecido.
 */
export function filtrosAuxiliaresDaContagem(
  sp: URLSearchParams,
): FiltroDeContagem[] {
  const filtros: FiltroDeContagem[] = [];
  const canal = sp.get("channel_session_id");
  if (canal) filtros.push(["channel_session_id", canal]);
  const setor = sp.get("atendimento_setor_id");
  if (setor) filtros.push(["atendimento_setor_id", setor]);
  // O MARCADOR não entra nesta lista, e não é esquecimento: ele não é
  // IGUALDADE numa coluna, é um `or=` sobre DUAS caixas — `conversations.tags`
  // e o campo calculado do contato. `conversations` não tem coluna `tag` (`tag`
  // é o nome do parâmetro da URL): com ele aqui, o laço lá embaixo pedia
  // `.eq("tag", …)`, o PostgREST devolvia 42703 (`undefined_column`) e a rota
  // INTEIRA respondia 500 — com um marcador filtrado, toda aba do Inbox ficava
  // sem número, a "Fechadas" inclusive (#1223). Quem aplica o marcador é
  // `aplicarMarcador`, a mesma régua que a lista usa.
  return filtros;
}

/** Verdadeiro quando a contagem deve pedir só as não lidas. */
export function contagemSoNaoLidas(sp: URLSearchParams): boolean {
  return sp.get("unread") === "true";
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  // loadAuthUser já chama getUser() no servidor; a segunda validação no mesmo
  // request acrescentava uma ida à rede em toda atualização dos badges.
  const authUser = await loadAuthUser();
  if (!authUser) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const supabase = await createClient();
  const ativa = await orgAtivaDaApi(authUser, requestId);
  if (!ativa.ok) return ativa.response;
  const activeOrg = ativa.org;
  if (!activeOrg) {
    return fail(
      "no_active_org",
      traduzir("No active organization.", authUser?.idioma ?? "pt-BR"),
      403,
      { requestId },
    );
  }

  const org = activeOrg.orgId;
  const sp = req.nextUrl.searchParams;
  const auxiliares = filtrosAuxiliaresDaContagem(sp);
  const soNaoLidas = contagemSoNaoLidas(sp);
  // ⚠️ O badge conta o MESMO que a lista mostra, então o marcador é lido com
  // `getAll` e o `modo` viaja junto (#1274). Ler com `get` aqui deixaria o badge
  // de um filtro de duas etiquetas contando uma só — e a aba diria "Fila 3"
  // listando duas: exatamente a divergência que este arquivo existe para
  // impedir, agora pelo caminho do marcador em vez do de canal.
  const marcadores = sp.getAll("tag");
  const modo = modoDeEtiqueta(sp.get("modo")) ?? "e";

  // ⚠️ TODA contagem nasce daqui, e daqui já sai com `organization_id` E com os
  // filtros auxiliares. Herdar tira a opção de esquecer: não existe o caminho
  // "montei uma contagem e não pus o filtro".
  //
  // Pessoal não soma em nenhuma aba (spec 21, etapa 7 — critério 3): ao marcar,
  // a contagem cai exatamente nas não-lidas daquele contato. A MESMA exclusão
  // da lista, pela mesma primitiva — sem ela o badge diria o que a aba esconde.
  // As exclusões e o estado do automático são independentes. Cada await em
  // série atrasava as seis contagens, que só podem começar depois delas.
  const [pessoais, idsDesativados, automaticoDaOrg] = await Promise.all([
    idsDeContatosPessoais(supabase, org),
    idsDosCanaisDesativados(supabase, org),
    orgTemAutomatico(supabase, org),
  ]);
  const countExact = () => {
    let q = supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org);
    if (idsDesativados.length > 0) q = q.not("channel_session_id", "in", `(${idsDesativados.join(",")})`);
    for (const [coluna, valor] of auxiliares) q = q.eq(coluna, valor);
    // O marcador entra pela régua da LISTA — a mesma função, não uma segunda.
    q = aplicarMarcadores(q, marcadores, modo);
    if (pessoais.length > 0) q = q.not("contact_id", "in", `(${pessoais.join(",")})`);
    if (soNaoLidas) q = q.gt("unread_count_for_assignee", 0);
    return q;
  };

  // Espelha tabToFilter (InboxLayout): unassigned = fila aberta sem dono;
  // mine = atribuídas a mim e ainda ABERTAS; all = tudo que o usuário VÊ.
  //
  // O `not in (terminais)` do `mine` espelha o `exclude_finished` da aba, e o
  // espelhamento é o ponto: um badge que conta o que a aba não mostra é pior
  // que badge nenhum — manda o atendente procurar um trabalho que não existe.
  // O fato ORG-WIDE resolvido ANTES das contagens, porque ele escolhe QUAL
  // conjunto de comandos a Fila pede. `undefined` (não deu para saber) segue a
  // convenção da regra: assume que há automático.
  const [fila, automatico, mine, all, closed, archived] = await Promise.all([
    // A FILA DEIXOU DE SER "sem dono + status de espera".
    //
    // Aquele par contava como trabalho humano pendente tudo que o robô estava
    // atendendo: medido na VPS em 2026-08-30, o badge dizia 83 enquanto 47
    // daquelas conversas tinham o automático no comando. Agora ele conta o mesmo
    // predicado que a aba pede — e o espelhamento entre badge e aba é vigiado
    // por `tests/e2e/inbox-abas-espelham-o-comando.spec.ts`,
    // `tests/unit/fila-tem-uma-definicao-so.test.ts` e
    // `tests/invariants/gov-5b-inbox-scope-counts.test.ts`, porque um badge que conta o
    // que a aba não mostra manda o atendente procurar trabalho que não existe.
    countExact().in("comando_da_conversa", comandosDaFila(automaticoDaOrg)),
    // A aba "Automático". Antes ela pedia `status='ai_handling'`, escrito por UM
    // caminho só em produção — por isso vivia quase vazia.
    countExact().eq("comando_da_conversa", "automatico"),
    countExact()
      .eq("assigned_to_user_id", authUser.id)
      .not("status", "in", `(${CONVERSATION_TERMINAL_STATUSES.join(",")})`),
    countExact(),
    // Parcelas disjuntas do histórico unificado. A API v1 preserva os campos
    // antigos; Encerrados recebe a soma dos dois sem nova consulta.
    countExact().eq("status", "closed"),
    countExact().eq("status", "archived"),
  ]);

  const firstErr =
    fila.error ?? automatico.error ?? mine.error ?? all.error ?? closed.error ?? archived.error;
  if (firstErr) {
    return fail("internal_error", firstErr.message, 500, { requestId });
  }

  return ok(
    {
      fila: fila.count ?? 0,
      automatico: automatico.count ?? 0,
      // `unassigned` continua respondendo, com o MESMO valor de `fila`. É rota
      // `/api/v1/` versionada: campo não some de uma versão para outra, e um
      // cliente com a página aberta desde antes do deploy segue lendo o nome
      // velho até recarregar.
      unassigned: fila.count ?? 0,
      mine: mine.count ?? 0,
      all: all.count ?? 0,
      closed: closed.count ?? 0,
      archived: archived.count ?? 0,
      // Soma dos estados disjuntos já contados, sem consulta adicional. Os
      // campos anteriores continuam disponíveis para clientes da API v1.
      encerrados: (closed.count ?? 0) + (archived.count ?? 0),
    },
    { requestId },
  );
}
