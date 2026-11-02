import { describe, expect, it } from "vitest";
import { filterParams, parseFilterParams, presetRange, toApiFilter } from "./filters";

describe("URL filters", () => {
  it("round-trips through the URL", () => {
    const state = { q: "coffee", type: "expense" as const, range: "this-month" as const };
    expect(parseFilterParams(filterParams(state))).toEqual(state);
    expect(filterParams({ range: "all" }).toString()).toBe(""); // defaults stay out of the URL
  });

  it("drops anything invalid instead of trusting it", () => {
    const parsed = parseFilterParams(
      new URLSearchParams("type=hacked&account=not-a-uuid&range=forever"),
    );
    expect(parsed).toEqual({ range: "all" });
  });

  it("turns presets into half-open local date ranges", () => {
    const now = new Date(2026, 2, 15); // 15 March 2026, local time
    expect(presetRange("this-month", now)).toEqual({ from: "2026-03-01", to: "2026-04-01" });
    expect(presetRange("last-month", now)).toEqual({ from: "2026-02-01", to: "2026-03-01" });
    expect(presetRange("this-year", now)).toEqual({ from: "2026-01-01", to: "2027-01-01" });
    expect(presetRange("last-90-days", now)).toEqual({ from: "2025-12-16", to: "2026-03-16" });
    expect(toApiFilter({ range: "all", q: "x" })).toEqual({ q: "x" });
  });
});
