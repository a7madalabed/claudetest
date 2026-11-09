import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MonthStatement } from "./month-statement";

// The household's wall clock: 9 November 2026.
const now = new Date(2026, 10, 9, 12);

const statement = {
  month: "2026-11",
  currency: "USD",
  broughtForwardMinor: 100_000,
  receivedMinor: 200_000,
  spentMinor: 5_000,
  netWorthMinor: 295_000,
};

const renderStatement = (props: Partial<Parameters<typeof MonthStatement>[0]> = {}) =>
  render(
    <MonthStatement
      now={now}
      currency="USD"
      statement={statement}
      previousSpentMinor={undefined}
      savingsRate={0.975}
      {...props}
    />,
  );

/** What a screen reader (or a person with a pencil) reads: the label and its figure. */
const row = (label: string) => {
  const term = screen.getByText(label, { selector: "dt, dt *" }).closest("dt")!;
  return term.parentElement!;
};

describe("MonthStatement", () => {
  it("writes the server's four figures as a sum that adds up", () => {
    renderStatement();
    expect(within(row("Brought forward")).getAllByText("$1,000.00").length).toBeGreaterThan(0);
    expect(within(row("Received")).getByText("+$2,000.00")).toBeTruthy();
    expect(within(row("Spent")).getByText("−$50.00")).toBeTruthy();
    expect(within(row("Net worth today")).getAllByText("$2,950.00").length).toBeGreaterThan(0);
    expect(statement.broughtForwardMinor + statement.receivedMinor - statement.spentMinor).toBe(
      statement.netWorthMinor,
    );
  });

  it("never invents an 'adjusted' line to make the sum work", () => {
    // Even if the figures were inconsistent, the page shows what the server said:
    // the old "Accounts added or adjusted" line (made-up money) no longer exists.
    renderStatement({ statement: { ...statement, netWorthMinor: 1 } });
    expect(screen.queryByText(/adjusted/i)).toBeNull();
  });

  it("says 'Net worth', because a loan or card lowers it (it isn't cash in hand)", () => {
    renderStatement({ statement: { ...statement, netWorthMinor: -55_000 } });
    expect(screen.queryByText(/in hand/i)).toBeNull();
    expect(within(row("Net worth today")).getAllByText("−$550.00").length).toBeGreaterThan(0);
  });

  it("shows placeholders, not zeros, while the figures load", () => {
    const { container } = renderStatement({ statement: undefined, savingsRate: undefined });
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("compares spending with the same days of last month", () => {
    renderStatement({ previousSpentMinor: 10_000 });
    expect(screen.getByText("50% less than the same days of October")).toBeTruthy();
  });
});
