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
  /** Days of the month it falls on (monthly: one, twice-monthly: two, weekly: none). */
  daysOfMonth: number[];
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

/** A recurring schedule: weekly, or on fixed days of the month. */
export interface RecurrenceRule {
  cadence: Cadence;
  /** Monthly: the day of month. Twice-monthly: the first of the two days. Weekly: unused. */
  anchorDay?: number | null;
  /** Twice-monthly only: the second day (e.g. 1st and 15th). */
  secondDay?: number | null;
}

const clampDay = (year: number, month: number, day: number) =>
  Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());

/**
 * The first due date strictly AFTER `after`. Days past a month's end are clamped
 * (the 31st → Feb 28) but the rule keeps its anchor, so March is the 31st again.
 * Shared by detection (predicting the next bill) and the scheduler (creating it),
 * so the two can never disagree.
 */
export function nextRecurringDate(rule: RecurrenceRule, after: string): string {
  if (rule.cadence === "weekly") return toDate(toTime(after) + 7 * DAY_MS);
  const days = [rule.anchorDay, rule.cadence === "twice_monthly" ? rule.secondDay : null].filter(
    (d): d is number => typeof d === "number",
  );
  const base = new Date(`${after}T00:00:00Z`);
  for (let offset = 0; offset <= 2; offset++) {
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth() + offset;
    const candidates = days
      .map((day) => {
        const first = new Date(Date.UTC(year, month, 1));
        return toDate(
          Date.UTC(
            first.getUTCFullYear(),
            first.getUTCMonth(),
            clampDay(first.getUTCFullYear(), first.getUTCMonth(), day),
          ),
        );
      })
      .filter((date) => date > after)
      .sort();
    if (candidates[0]) return candidates[0];
  }
  throw new Error("No next date found"); // unreachable for valid rules
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
    const dayOf = (date: string) => Number(date.slice(8, 10));
    const daysOfMonth =
      match.cadence === "monthly"
        ? [dayOf(last.date)]
        : match.cadence === "twice_monthly"
          ? [...new Set(sorted.slice(-2).map((t) => dayOf(t.date)))].sort((a, b) => a - b)
          : [];
    const rule: RecurrenceRule = {
      cadence: match.cadence,
      anchorDay: daysOfMonth[0] ?? null,
      secondDay: daysOfMonth[1] ?? null,
    };
    // Twice-monthly needs two distinct days; otherwise treat the gap literally.
    const step = (date: string) =>
      match.cadence === "twice_monthly" && daysOfMonth.length < 2
        ? toDate(toTime(date) + Math.round(typicalGap) * DAY_MS)
        : nextRecurringDate(rule, date);
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
      daysOfMonth,
      accountId: last.accountId,
      categoryId: last.categoryId,
    });
  }
  return series.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
