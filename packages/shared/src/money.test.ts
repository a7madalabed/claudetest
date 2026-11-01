import { describe, expect, it } from "vitest";
import { currencyDecimals, formatMoney, parseMoney, sumMinorUnits } from "./money.js";

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

  it("parses user input into minor units without floating point", () => {
    expect(parseMoney("12.50", "USD")).toBe(1250);
    expect(parseMoney("1,234.5", "USD")).toBe(123450);
    expect(parseMoney(".99", "USD")).toBe(99);
    expect(parseMoney("0.29", "USD")).toBe(29); // 0.29 * 100 = 28.999999999999996 with floats!
    expect(parseMoney("1500", "JPY")).toBe(1500);
    expect(parseMoney("1.250", "JOD")).toBe(1250);
  });

  it("rejects invalid amounts", () => {
    for (const bad of ["", ".", "abc", "-5", "1.234", "1.2.3", "12a"]) {
      expect(parseMoney(bad, "USD"), bad).toBeNull();
    }
    expect(parseMoney("1.5", "JPY")).toBeNull();
  });
});
