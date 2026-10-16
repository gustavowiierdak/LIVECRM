import { z } from "zod";

export const recursosIxcSchema = z.object({
  customers: z.boolean().default(false),
  contracts: z.boolean().default(false),
  receivables: z.boolean().default(false),
  service_orders: z.boolean().default(false),
  diagnostics: z.boolean().optional(),
  create_service_orders: z.boolean().optional(),
  monitor_service_orders: z.boolean().optional(),
  service_order_routing: z
    .object({
      sem_conexao: z.string().trim().max(100),
      lentidao: z.string().trim().max(100),
      setor: z.string().trim().max(200),
    })
    .optional(),
});

export type IxcResource =
  | "customers"
  | "contracts"
  | "receivables"
  | "service_orders"
  | "diagnostics"
  | "create_service_orders"
  | "monitor_service_orders";
export type IxcRouting = z.infer<typeof recursosIxcSchema>["service_order_routing"];
