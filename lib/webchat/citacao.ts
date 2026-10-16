import { z } from "zod";

/** Apenas campos de exibição; nunca devolver metadata arbitrária ao visitante. */
export const citacaoWebchatSchema = z.object({
  id: z.uuid(),
  direction: z.enum(["visitor", "operator"]),
  sender_name: z.string().max(300).nullable().optional(),
  body: z.string().max(1000),
  created_at: z.iso.datetime({ offset: true }),
});
