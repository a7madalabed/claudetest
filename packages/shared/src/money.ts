/**
 * Money helpers.
 *
 * RULE #1 of financial software: never store money as a floating-point number.
 * In JavaScript, 0.1 + 0.2 === 0.30000000000000004. Over thousands of
 * transactions those tiny errors add up to real, visible cents.
 *
 * Instead we store integers in the currency's *minor unit*: cents for USD
 * (2 decimals), fils for JOD (3 decimals), and plain yen for JPY (0 decimals).
 * All arithmetic happens on integers,
 * and we only convert to a human-readable string at the very edge — the UI.
 */

/** An amount of money in minor units (e.g. cents). Always an integer. */
export type MinorUnits = number;

/** Throws if the value isn't a safe integer — catches float bugs early. */
export function assertMinorUnits(value: number): asserts value is MinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money must be an integer number of minor units, got ${value}`);
  }
}

/** How many decimal places a currency uses (USD → 2, JPY → 0, JOD → 3). */
export function currencyDecimals(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Adds amounts safely. Integers in, integer out — no rounding drift. */
export function sumMinorUnits(amounts: readonly MinorUnits[]): MinorUnits {
  let total = 0;
  for (const amount of amounts) {
    assertMinorUnits(amount);
    total += amount;
  }
  assertMinorUnits(total);
  return total;
}

/**
 * Formats minor units for display using the browser's built-in, locale-aware
 * Intl API (correct symbols, separators and digit grouping for every locale).
 *
 * formatMoney(123456, "USD")          → "$1,234.56"
 * formatMoney(-500, "EUR", "de-DE")   → "-5,00 €"
 */
export function formatMoney(amount: MinorUnits, currency: string, locale = "en-US"): string {
  assertMinorUnits(amount);
  const decimals = currencyDecimals(currency);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount / 10 ** decimals);
}

/**
 * Parses what a user typed ("1,234.5", "12", ".99") into minor units WITHOUT ever
 * going through a floating-point number — the string is split into whole and
 * fractional digits and combined with integer maths.
 *
 * Returns `null` for anything that isn't a valid non-negative amount for the
 * currency (e.g. too many decimals: "1.234" for USD).
 *
 * parseMoney("1,234.5", "USD") → 123450
 * parseMoney("1500", "JPY")    → 1500
 * parseMoney("abc", "USD")     → null
 */
export function parseMoney(input: string, currency: string): MinorUnits | null {
  const decimals = currencyDecimals(currency);
  const cleaned = input.trim().replace(/[,\s]/g, "");
  const pattern = decimals === 0 ? /^(\d+)$/ : new RegExp(`^(\\d*)(?:\\.(\\d{0,${decimals}}))?$`);
  const match = pattern.exec(cleaned);
  if (!match || cleaned === "" || cleaned === ".") return null;

  const whole = match[1] || "0";
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  const result = Number(whole) * 10 ** decimals + Number(fraction || "0");
  return Number.isSafeInteger(result) ? result : null;
}
