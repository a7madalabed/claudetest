import { describe, expect, it } from "vitest";
import { dayAfter, throughToday } from "./months.js";

describe("dayAfter", () => {
  it("steps over month and year ends, and leap days", () => {
    expect(dayAfter("2026-11-09")).toBe("2026-11-10");
    expect(dayAfter("2026-11-30")).toBe("2026-12-01");
    expect(dayAfter("2026-12-31")).toBe("2027-01-01");
    expect(dayAfter("2028-02-28")).toBe("2028-02-29");
    expect(dayAfter("2028-02-29")).toBe("2028-03-01");
  });
});

describe("throughToday", () => {
  // Ranges are [from, to): `to` is exclusive, so "through today" means to = tomorrow.
  it("cuts a range that reaches past today, so entries dated later aren't counted", () => {
    expect(throughToday({ from: "2026-11-01", to: "2026-12-01" }, "2026-11-09")).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
    });
  });

  it("leaves a range that ends today or earlier alone", () => {
    expect(throughToday({ from: "2026-10-01", to: "2026-11-01" }, "2026-11-09")).toEqual({
      from: "2026-10-01",
      to: "2026-11-01",
    });
    expect(throughToday({ from: "2026-11-01", to: "2026-11-10" }, "2026-11-09")).toEqual({
      from: "2026-11-01",
      to: "2026-11-10",
    });
  });

  it("keeps any other field on the range", () => {
    const cut = throughToday(
      { from: "2026-11-01", to: "2027-01-01", currency: "USD" },
      "2026-11-09",
    );
    expect(cut).toEqual({ from: "2026-11-01", to: "2026-11-10", currency: "USD" });
  });
});
