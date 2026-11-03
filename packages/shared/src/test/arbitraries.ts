import fc from "fast-check";

/*
 * Generators ("arbitraries") shared by the property tests. Each one produces
 * random values of a domain type; when a property fails, fast-check SHRINKS the
 * input to the smallest one that still fails before reporting it.
 */

const DAY_MS = 86_400_000;
const MIN = Date.UTC(1900, 0, 1);
const MAX = Date.UTC(2100, 11, 31);

/** A calendar day "YYYY-MM-DD" between 1900 and 2100. */
export const isoDate = fc
  .integer({ min: 0, max: (MAX - MIN) / DAY_MS })
  .map((days) => new Date(MIN + days * DAY_MS).toISOString().slice(0, 10));

/** A month "YYYY-MM" between 1900 and 2100. */
export const yearMonth = isoDate.map((d) => d.slice(0, 7));

/** Any amount a person could plausibly have: up to ±$10 trillion in cents. */
export const amountMinor = fc.integer({ min: -1e15, max: 1e15 });

/** Every integer JavaScript can represent exactly — the full range MinorUnits allows. */
export const safeInteger = fc.maxSafeInteger();

/** Strings that look a bit like what bank exports contain, plus total junk. */
export const csvCell = fc.oneof(
  fc.string({ maxLength: 20 }),
  fc.stringMatching(/^[-+($€£ ]{0,2}[\d.,]{0,12}[)\- ]{0,2}$/),
  fc.stringMatching(/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}$/),
);
