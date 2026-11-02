import { describe, expect, it } from "vitest";
import { alertBody } from "./evaluate.job.js";

describe("alertBody", () => {
  it("states spent of available", () => {
    expect(
      alertBody({ spentMinor: 9_500, availableMinor: 9_000, rolloverMinor: 0 }, "November", "USD"),
    ).toBe("$95.00 of $90.00 spent in November.");
  });
  it("explains a budget that starts the month below zero", () => {
    expect(
      alertBody(
        { spentMinor: 6_140, availableMinor: -3_000, rolloverMinor: -53_000 },
        "November",
        "USD",
      ),
    ).toBe("$61.40 spent in November, with $530.00 of earlier overspending still carried over.");
  });
});
