/**
 * Finds recurring bills and income (rent, subscriptions, salary) in a history of
 * transactions, and predicts the next one. No machine learning — a few honest
 * rules that are easy to explain to a user ("we saw this 6 times, about monthly"):
 *
 *  1. Group by a normalised description and direction (in/out).
 *  2. Need ≥ 3 occurrences.
 *  3. The typical gap (median days between occurrences) must match a cadence,
 *     and ≥ 75% of gaps must be close to it (regularity).
 *  4. The last one must be recent enough that the series hasn't ended.
 */

export type Cadence = "weekly" | "twice_monthly" | "monthly";

export interface RecurringInput {
  date: string; // YYYY-MM-DD
  description: string;
  amountMinor: number;
  accountId: string;
  categoryId: string | null;
}

export interface RecurringSeries {
  key: string;
  description: string;
  cadence: Cadence;
  /** Typical amount (median), signed like the transactions. */
  amountMinor: number;
  /** Amounts vary by more than 10% (utilities) — show as "about". */
  variable: boolean;
  occurrences: number;
  lastDate: string;
  nextDate: string;
  accountId: string;
  categoryId: string | null;
}

const CADENCES: Array<{ cadence: Cadence; min: number; max: number; tolerance: number }> = [
  { cadence: "weekly", min: 6, max: 8, tolerance: 1 },
  { cadence: "twice_monthly", min: 13, max: 17, tolerance: 3 },
  { cadence: "monthly", min: 26, max: 35, tolerance: 4 },
];

const DAY_MS = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** "Uber trip #4521" and "UBER TRIP #9" are the same merchant. */
export const normaliseDescription = (text: string) =>
  text
    .toLowerCase()
    .replace(/[#\d]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The `anchorDay` of the month after `date`, clamped to that month's length
 * (a bill on the 31st falls on Feb 28, then back on Mar 31 — the anchor stops it drifting).
 */
function nextMonthlyDate(date: string, anchorDay: number) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = anchorDay;
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return toDate(next.getTime());
}

export function detectRecurring(transactions: RecurringInput[], today: string): RecurringSeries[] {
  const groups = new Map<string, RecurringInput[]>();
  for (const t of transactions) {
    const key = `${normaliseDescription(t.description)}|${t.amountMinor < 0 ? "out" : "in"}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const series: RecurringSeries[] = [];
  for (const [key, items] of groups) {
    if (items.length < 3) continue;
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const gaps = sorted
      .slice(1)
      .map((t, i) => Math.round((toTime(t.date) - toTime(sorted[i]!.date)) / DAY_MS));
    const typicalGap = median(gaps);
    const match = CADENCES.find((c) => typicalGap >= c.min && typicalGap <= c.max);
    if (!match) continue;
    const regular =
      gaps.filter((gap) => Math.abs(gap - typicalGap) <= match.tolerance).length / gaps.length;
    if (regular < 0.75) continue;

    const last = sorted.at(-1)!;
    const daysSinceLast = (toTime(today) - toTime(last.date)) / DAY_MS;
    if (daysSinceLast > typicalGap * 1.5) continue; // the series has stopped

    const amounts = sorted.map((t) => Math.abs(t.amountMinor));
    const typical = Math.round(median(amounts));
    const spread = (Math.max(...amounts) - Math.min(...amounts)) / typical;
    const anchorDay = Number(last.date.slice(8, 10));
    const step = (date: string) =>
      match.cadence === "monthly"
        ? nextMonthlyDate(date, anchorDay)
        : toDate(toTime(date) + Math.round(typicalGap) * DAY_MS);
    let next = step(last.date);
    // If the predicted date already passed without a new occurrence, roll forward.
    while (next < today) next = step(next);

    series.push({
      key,
      description: last.description,
      cadence: match.cadence,
      amountMinor: last.amountMinor < 0 ? -typical : typical,
      variable: spread > 0.1,
      occurrences: sorted.length,
      lastDate: last.date,
      nextDate: next,
      accountId: last.accountId,
      categoryId: last.categoryId,
    });
  }
  return series.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
