export type MensagemWebchat = Readonly<{
  id: string;
  direction: "visitor" | "operator";
  body: string;
  created_at: string;
}>;

export type SessaoVisitanteWebchat = Readonly<{
  public_id?: string;
  sector: "suporte" | "financeiro" | "cancelamento";
  expires_at: string;
}>;

/** Metadados da sessão que a inbox autenticada pode consultar, sem expor segredos. */
export type SessaoOperadorWebchat = Readonly<{
  id: string;
  sector: "suporte" | "financeiro" | "cancelamento";
  expires_at: string;
  active: boolean;
}>;

export type ConfiguracaoWebchat = Readonly<{
  public_id?: string | null;
  enabled: boolean;
  allowed_sectors: Array<"suporte" | "financeiro" | "cancelamento">;
  allowed_origins: string[];
  handoff_ttl_seconds: number;
}>;
