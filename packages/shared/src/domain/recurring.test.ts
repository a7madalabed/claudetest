import { describe, expect, it } from "vitest";
import { detectRecurring, normaliseDescription, type RecurringInput } from "./recurring.js";

const tx = (date: string, description: string, amountMinor: number): RecurringInput => ({
  date,
  description,
  amountMinor,
  accountId: "acc",
  categoryId: null,
});

const TODAY = "2026-06-15";

describe("normaliseDescription", () => {
  it("ignores case, digits and reference numbers", () => {
    expect(normaliseDescription("UBER Trip #4521")).toBe(normaliseDescription("uber trip 9"));
  });
});

describe("detectRecurring", () => {
  it("finds monthly rent and predicts the same day next month", () => {
    const rent = ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"].map((d) =>
      tx(d, "Rent", -180_000),
    );
    const [series] = detectRecurring(rent, TODAY);
    expect(series).toMatchObject({
      cadence: "monthly",
      amountMinor: -180_000,
      variable: false,
      occurrences: 5,
      nextDate: "2026-07-01",
    });
  });

  it("keeps a month-end bill anchored to its day (no drift after February)", () => {
    const bill = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"].map((d) =>
      tx(d, "Gym", -4_000),
    );
    expect(detectRecurring(bill, "2026-06-01")[0]?.nextDate).toBe("2026-06-30");
  });

  it("finds twice-monthly salary", () => {
    const salary = [
      "2026-03-01",
      "2026-03-15",
      "2026-04-01",
      "2026-04-15",
      "2026-05-01",
      "2026-05-15",
      "2026-06-01",
    ].map((d) => tx(d, "Payroll ACME 0042", 250_000));
    const [series] = detectRecurring(salary, TODAY);
    expect(series?.cadence).toBe("twice_monthly");
    expect(series?.amountMinor).toBe(250_000);
    expect(series!.nextDate >= TODAY).toBe(true);
  });

  it("marks utilities with changing amounts as variable", () => {
    const power = [
      tx("2026-03-10", "City Power", -8_000),
      tx("2026-04-10", "City Power", -9_500),
      tx("2026-05-10", "City Power", -7_200),
      tx("2026-06-10", "City Power", -8_800),
    ];
    const [series] = detectRecurring(power, TODAY);
    expect(series?.variable).toBe(true);
    expect(series?.amountMinor).toBe(-8_400); // median of 7,200 / 8,000 / 8,800 / 9,500
  });

  it("ignores series that have ended, irregular ones and one-offs", () => {
    const ended = ["2026-01-05", "2026-02-05", "2026-03-05"].map((d) =>
      tx(d, "Old streaming", -1_500),
    );
    const irregular = ["2026-01-02", "2026-01-09", "2026-03-20", "2026-05-30"].map((d) =>
      tx(d, "Hardware store", -3_000),
    );
    const twice = ["2026-05-02", "2026-06-02"].map((d) => tx(d, "Twice only", -1_000));
    expect(detectRecurring([...ended, ...irregular, ...twice], TODAY)).toEqual([]);
  });

  it("keeps money in and money out with the same name apart", () => {
    const refunds = ["2026-04-03", "2026-05-03", "2026-06-03"].map((d) => tx(d, "Shop", 500));
    const purchases = ["2026-04-03", "2026-05-03", "2026-06-03"].map((d) => tx(d, "Shop", -500));
    expect(detectRecurring([...refunds, ...purchases], TODAY)).toHaveLength(2);
  });

  it("rolls a missed prediction forward and sorts by next date", () => {
    const weekly = ["2026-05-18", "2026-05-25", "2026-06-01", "2026-06-08"].map((d) =>
      tx(d, "Veg box", -2_500),
    );
    const monthly = ["2026-04-20", "2026-05-20"]
      .concat("2026-03-20")
      .map((d) => tx(d, "Phone", -3_000));
    const result = detectRecurring([...monthly, ...weekly], TODAY);
    expect(result.map((s) => [s.description, s.nextDate])).toEqual([
      ["Veg box", "2026-06-15"],
      ["Phone", "2026-06-20"],
    ]);
  });
});
