/**
 * Query keys in ONE place. TanStack Query caches data by key; invalidating
 * `["households", id]` refreshes everything under that household at once.
 */
export const queryKeys = {
  me: ["me"] as const,
  sessions: ["auth", "sessions"] as const,
  household: (householdId: string) => ["households", householdId] as const,
  accounts: (householdId: string) => ["households", householdId, "accounts"] as const,
  transactions: (householdId: string, params: Record<string, unknown> = {}) =>
    ["households", householdId, "transactions", params] as const,
  cashflow: (householdId: string, range: { from: string; to: string }) =>
    ["households", householdId, "reports", "cashflow", range] as const,
};
