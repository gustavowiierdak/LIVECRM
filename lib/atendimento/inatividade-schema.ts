import { z } from "zod";

/** null = desligado. Os dois prazos sao independentes e visiveis na tela. */
export const aiInactivitySchema = z.object({
  warn_after_minutes: z.number().int().min(5).max(1440),
  close_after_warning_minutes: z.number().int().min(5).max(1440),
});
export type AiInactivityConfig = z.infer<typeof aiInactivitySchema>;
