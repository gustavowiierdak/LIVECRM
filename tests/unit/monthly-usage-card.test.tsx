import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonthlyUsageCard } from "@/components/ai/MonthlyUsageCard";

const { query, hook } = vi.hoisted(() => ({
  query: { data: undefined as unknown, isError: false, isFetching: false, refetch: vi.fn() },
  hook: vi.fn(),
}));
vi.mock("@/hooks/ai/useAiBudget", () => ({ useAiBudget: (opts: unknown) => { hook(opts); return query; } }));

beforeEach(() => {
  query.data = { monthly_limit_cents: 10000, current_month_consumed_cents: 1950,
    alarm_threshold_pct: 80, gasto_incompleto: false, blocked_now: false };
  query.isError = false;
  query.isFetching = false;
  vi.clearAllMocks();
});

describe("resumo mensal do gasto de IA", () => {
  it("mostra dólares reais, porcentagem e acesso ao orçamento existente", () => {
    render(<MonthlyUsageCard />);
    expect(screen.getByText(/19,50/)).toHaveTextContent("US$");
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "19.5");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/app/ai/usage");
    expect(hook).toHaveBeenCalledWith({ refetchInterval: 60000 });
  });
  it("não inventa limite nem porcentagem sem orçamento", () => {
    query.data = { ...query.data as object, monthly_limit_cents: 0 };
    render(<MonthlyUsageCard />);
    expect(screen.getByText("Sem limite definido")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("mostra excesso sem transbordar a barra e sinaliza medição parcial", () => {
    query.data = { ...query.data as object, current_month_consumed_cents: 15000, gasto_incompleto: true, blocked_now: true };
    render(<MonthlyUsageCard />);
    expect(screen.getByText("150%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText(/Total parcial/)).toBeInTheDocument();
    expect(screen.getByText("IA parada por gasto")).toBeInTheDocument();
  });
  it("não apresenta zero durante carregamento", () => {
    query.data = undefined;
    render(<MonthlyUsageCard />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando consumo...");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("mostra falha e permite tentar novamente", () => {
    query.isError = true;
    render(<MonthlyUsageCard />);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(query.refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Não foi possível carregar");
  });
});
