import { parseMoney } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import { currencySymbol, minorToInput } from "./money-input";

describe("money inputs", () => {
  it("shows minor units as editable text with the currency's decimals", () => {
    expect(minorToInput(123450, "USD")).toBe("1234.50");
    expect(minorToInput(-5, "USD")).toBe("0.05"); // the sign lives in the income/expense toggle
    expect(minorToInput(1200, "JPY")).toBe("1200"); // yen have no minor unit
  });

  it("round-trips through parseMoney", () => {
    for (const amount of [0, 1, 99, 100, 123450, 999_999_99]) {
      expect(parseMoney(minorToInput(amount, "USD"), "USD")).toBe(amount);
    }
  });

  it("finds the symbol to show inside the field", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("EUR")).toBe("€");
  });
});
