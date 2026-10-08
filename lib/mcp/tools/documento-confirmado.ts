import { hashCpf, normalizeCpf } from "@/lib/contacts/cpf";

import type { McpContext } from "../types";

export type DocumentoConfirmado =
  { ok: true; document: string } | { ok: false; resposta: { erro: string; mensagem: string } };

/** Restringe consultas financeiras ao CPF confirmado do contato deste turno. */
export async function confirmarDocumentoDoTurno(
  ctx: McpContext,
  informado: string,
): Promise<DocumentoConfirmado> {
  if (!ctx.contatoDoTurno) {
    return {
      ok: false,
      resposta: {
        erro: "sem_contato_do_turno",
        mensagem: "esta operação só pode ser feita dentro da conversa do próprio cliente.",
      },
    };
  }
  const documento = normalizeCpf(informado);
  if (documento.length !== 11) {
    return {
      ok: false,
      resposta: {
        erro: "documento_invalido",
        mensagem: "informe um CPF válido para esta consulta.",
      },
    };
  }
  const { data: contato } = await ctx.supabase
    .from("contacts")
    .select("cpf_hash")
    .eq("organization_id", ctx.organizationId)
    .eq("id", ctx.contatoDoTurno)
    .maybeSingle<{ cpf_hash: string | null }>();
  if (!contato?.cpf_hash) {
    return {
      ok: false,
      resposta: {
        erro: "cpf_nao_confirmado",
        mensagem:
          "o CPF ainda não foi confirmado no cadastro deste contato. Confirme e salve o documento antes de consultar faturas.",
      },
    };
  }
  if (hashCpf(documento) !== contato.cpf_hash) {
    return {
      ok: false,
      resposta: {
        erro: "cpf_nao_confere",
        mensagem: "o CPF informado não coincide com o documento confirmado deste contato.",
      },
    };
  }
  return { ok: true, document: documento };
}
