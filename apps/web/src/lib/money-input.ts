import { minorToDecimal } from "@ledgerly/shared";

/*
 * Helpers for money INPUTS. A form holds the amount as the text the user typed;
 * it becomes minor units only on submit, via parseMoney — never through a float.
 */

/** 123450 cents → "1234.50" for editing (the reverse of parseMoney). */
export function minorToInput(amountMinor: number, currency: string) {
  return minorToDecimal(Math.abs(amountMinor), currency);
}

/** "USD" → "$", "EUR" → "€" — shown inside the amount field. */
export function currencySymbol(currency: string) {
  return (
    new Intl.NumberFormat("en-US", { style: "currency", currency })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? currency
  );
}
