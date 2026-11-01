import { describe, expect, it } from "vitest";
import { currencyDecimals, formatMoney, sumMinorUnits } from "./money.js";

describe("money", () => {
  it("shows why floats are dangerous (the reason this module exists)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumMinorUnits([10, 20])).toBe(30);
  });

  it("knows each currency's minor-unit precision", () => {
    expect(currencyDecimals("USD")).toBe(2);
    expect(currencyDecimals("JPY")).toBe(0);
    expect(currencyDecimals("JOD")).toBe(3);
  });

  it("formats minor units for humans", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(1500, "JPY")).toBe("¥1,500");
    expect(formatMoney(-2500, "USD")).toBe("-$25.00");
  });

  it("rejects fractional minor units", () => {
    expect(() => formatMoney(10.5, "USD")).toThrow(TypeError);
    expect(() => sumMinorUnits([1, 0.5])).toThrow(TypeError);
  });
});
