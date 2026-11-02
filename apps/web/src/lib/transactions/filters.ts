import { TransactionFilterSchema, type TransactionFilter } from "@ledgerly/shared";

/**
 * Filters live in the URL (?q=coffee&type=expense&range=this-month), so a
 * filtered view survives reloads, the back button works, and you can send the
 * exact view to someone. The URL is parsed with the SAME schema the API uses.
 */

export const RANGE_PRESETS = {
  all: "All time",
  "this-month": "This month",
  "last-month": "Last month",
  "last-90-days": "Last 90 days",
  "this-year": "This year",
} as const;
export type RangePreset = keyof typeof RANGE_PRESETS;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Turns a preset into a half-open date range [from, to), in the user's local calendar. */
export function presetRange(preset: RangePreset, now = new Date()): { from?: string; to?: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "this-month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 1)) };
    case "last-month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 1)) };
    case "last-90-days":
      return {
        from: iso(new Date(y, m, now.getDate() - 89)),
        to: iso(new Date(y, m, now.getDate() + 1)),
      };
    case "this-year":
      return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y + 1, 0, 1)) };
    default:
      return {};
  }
}

export interface FilterState {
  q?: string;
  type?: TransactionFilter["type"];
  accountId?: string;
  categoryId?: string;
  range: RangePreset;
}

/** URL → state. Anything invalid in the URL is silently dropped (never trusted). */
export function parseFilterParams(params: URLSearchParams): FilterState {
  const range = params.get("range");
  const parsed = TransactionFilterSchema.pick({
    q: true,
    type: true,
    accountId: true,
    categoryId: true,
  }).safeParse({
    q: params.get("q") ?? undefined,
    type: params.get("type") ?? undefined,
    accountId: params.get("account") ?? undefined,
    categoryId: params.get("category") ?? undefined,
  });
  const base = parsed.success ? parsed.data : {};
  return { ...base, range: range && range in RANGE_PRESETS ? (range as RangePreset) : "all" };
}

/** State → URL (only non-default values, so URLs stay short and readable). */
export function filterParams(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.type) params.set("type", state.type);
  if (state.accountId) params.set("account", state.accountId);
  if (state.categoryId) params.set("category", state.categoryId);
  if (state.range !== "all") params.set("range", state.range);
  return params;
}

/** State → API filter. */
export function toApiFilter(state: FilterState, now = new Date()): TransactionFilter {
  const { range, ...rest } = state;
  return { ...rest, ...presetRange(range, now) };
}

export const hasActiveFilters = (state: FilterState) =>
  Boolean(state.q || state.type || state.accountId || state.categoryId || state.range !== "all");
