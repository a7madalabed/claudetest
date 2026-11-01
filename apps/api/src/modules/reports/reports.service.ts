import { getMonthlyCashflow, getSpendingByCategory, type Database } from "@ledgerly/db";

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

export async function spendingByCategoryReport(db: Database, householdId: string, range: Range) {
  const rows = await getSpendingByCategory(db, householdId, range);
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
