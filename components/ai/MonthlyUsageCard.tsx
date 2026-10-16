"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Coins, Gear } from "@/lib/ui/icons";
import { useAiBudget } from "@/hooks/ai/useAiBudget";
import { useT } from "@/hooks/i18n/useT";
import { useTagDeIdioma } from "@/hooks/i18n/useLocaleDeData";

/** Same monthly ledger and permissions as Uso de IA; never converts USD into BRL. */
export function MonthlyUsageCard() {
  const t = useT();
  const locale = useTagDeIdioma();
  const query = useAiBudget({ refetchInterval: 60_000 });
  const status = query.data;
  const money = (cents: number) => new Intl.NumberFormat(locale, {
    style: "currency", currency: "USD",
  }).format(cents / 100);
  const hasLimit = Boolean(status && status.monthly_limit_cents > 0);
  const pct = status && hasLimit
    ? status.current_month_consumed_cents * 100 / status.monthly_limit_cents : 0;

  return (
    <Card className="w-full max-w-xl rounded-2xl p-5 sm:p-6" aria-label={t("Consumo deste mês")}>
      <h2 className="flex items-center gap-2 text-base font-medium">
        <Coins size={22} aria-hidden />{t("Consumo deste mês")}
      </h2>
      {query.isError ? (
        <div className="mt-4 space-y-2" role="status">
          <p className="text-sm text-muted-foreground">{t("Não foi possível carregar o consumo de IA.")}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            {t("Tentar novamente")}
          </Button>
        </div>
      ) : !status ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">{t("Carregando consumo...")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 tabular-nums">
            <p className="min-w-0 break-words">
              <strong className="text-2xl font-semibold">{money(status.current_month_consumed_cents)}</strong>
              {hasLimit && <span className="text-lg text-muted-foreground"> / {money(status.monthly_limit_cents)}</span>}
            </p>
            <span className="text-sm text-muted-foreground">{hasLimit ? `${Math.round(pct)}%` : t("Sem limite definido")}</span>
          </div>
          {hasLimit && (
            <div role="progressbar" aria-label={t("Consumo do limite mensal")}
              aria-valuenow={Math.min(100, Math.max(0, pct))} aria-valuemin={0} aria-valuemax={100}
              aria-valuetext={`${Math.round(pct)}%`}
              className="h-2 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${pct >= 100 ? "bg-destructive" : pct >= status.alarm_threshold_pct ? "bg-amber-500" : "bg-emerald-600"}`}
                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t("Valores em US$ · gasto registrado de IA")}</p>
          {status.gasto_incompleto && <p className="text-xs text-warning-fg" role="status">{t("Total parcial: há chamadas sem preço conhecido. Confira também o painel do provedor.")}</p>}
          {status.blocked_now && <p className="text-sm font-medium text-destructive">{t("IA parada por gasto")}</p>}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>{t("Reinicia mensalmente")}</span>
        <Link href="/app/ai/usage" aria-label={t("Ver consumo e configurações de IA")}
          title={t("Ver consumo e configurações de IA")}
          className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <Gear size={20} aria-hidden />
        </Link>
      </div>
    </Card>
  );
}
