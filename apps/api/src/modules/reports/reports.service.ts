import {
  and,
  dashboardLayouts,
  eq,
  getDailyCashflow,
  getMonthlyCashflow,
  getNetWorthSeries,
  getSpendingByCategory,
  getSpendingBySubcategory,
  sql,
  type Database,
} from "@ledgerly/db";
import type { DashboardWidget } from "@ledgerly/shared";

type Range = { from: string; to: string };

export async function cashflowReport(db: Database, householdId: string, range: Range) {
  const months = await getMonthlyCashflow(db, householdId, range);
  return {
    months: months.map((month) => ({
      ...month,
      netMinor: month.incomeMinor - month.spendingMinor,
    })),
  };
}

export async function spendingByCategoryReport(
  db: Database,
  householdId: string,
  range: Range & { parentId?: string },
) {
  const rows = range.parentId
    ? await getSpendingBySubcategory(db, householdId, range.parentId, range)
    : await getSpendingByCategory(db, householdId, range);
  const totalMinor = rows.reduce((sum, row) => sum + row.spendingMinor, 0);
  return {
    totalMinor,
    categories: rows.map((row) => ({
      ...row,
      // Rounded to 4 decimals: shares are for display (percent bars), never for money maths.
      share: totalMinor === 0 ? 0 : Math.round((row.spendingMinor / totalMinor) * 10_000) / 10_000,
    })),
  };
}

export async function netWorthReport(
  db: Database,
  householdId: string,
  range: Range & { currency: string },
) {
  return { currency: range.currency, points: await getNetWorthSeries(db, householdId, range) };
}

export async function dailyCashflowReport(db: Database, householdId: string, range: Range) {
  return { days: await getDailyCashflow(db, householdId, range) };
}

// ─── Dashboard layout (a per-user preference) ───────────────────────────────

export const DEFAULT_DASHBOARD: DashboardWidget[] = [
  "cashflow",
  "spending-by-category",
  "net-worth",
  "accounts",
  "recent-activity",
];

export async function getDashboardLayout(db: Database, userId: string, householdId: string) {
  const [row] = await db
    .select({ widgets: dashboardLayouts.widgets })
    .from(dashboardLayouts)
    .where(and(eq(dashboardLayouts.userId, userId), eq(dashboardLayouts.householdId, householdId)));
  // Widgets added to the app after the user saved their layout are appended,
  // so new features show up without resetting anyone's arrangement.
  const saved = (row?.widgets ?? DEFAULT_DASHBOARD).filter((id): id is DashboardWidget =>
    DEFAULT_DASHBOARD.includes(id as DashboardWidget),
  );
  return { widgets: [...saved, ...DEFAULT_DASHBOARD.filter((id) => !saved.includes(id))] };
}

/** Upsert: one row per (user, household), replaced wholesale on every save. */
export async function saveDashboardLayout(
  db: Database,
  userId: string,
  householdId: string,
  widgets: DashboardWidget[],
) {
  await db
    .insert(dashboardLayouts)
    .values({ userId, householdId, widgets })
    .onConflictDoUpdate({
      target: [dashboardLayouts.userId, dashboardLayouts.householdId],
      set: { widgets, updatedAt: sql`now()` },
    });
  return { widgets };
}
