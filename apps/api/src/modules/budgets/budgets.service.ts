import {
  and,
  asc,
  budgetAmounts,
  budgets,
  categories,
  eq,
  getBudgetMonthlySpending,
  getUnbudgetedSpending,
  inArray,
  isPgError,
  sql,
  type Database,
  type DbExecutor,
} from "@ledgerly/db";
import {
  STATUS_RANK,
  addMonths,
  computeBudgetMonth,
  toYearMonth,
  type BudgetDto,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from "@ledgerly/shared";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";

/*
 * Budgets: the DATABASE stores the facts (which category, the amount history,
 * the rollover flag); the maths that turns facts into "you have $83 left" is the
 * pure computeBudgetMonth() in @ledgerly/shared. This service only gathers the
 * facts and hands them over.
 */

const firstOf = (month: string) => `${month}-01`;

export async function getBudgetMonth(db: Database, householdId: string, month: string) {
  const rows = await db
    .select({
      id: budgets.id,
      categoryId: budgets.categoryId,
      startMonth: budgets.startMonth,
      rollover: budgets.rollover,
      name: categories.name,
      icon: categories.icon,
      parentIcon: sql<
        string | null
      >`(select p.icon from categories p where p.id = ${categories.parentId})`,
    })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .where(eq(budgets.householdId, householdId))
    .orderBy(asc(categories.name));

  const ids = rows.map((r) => r.id);
  const amounts = ids.length
    ? await db.select().from(budgetAmounts).where(inArray(budgetAmounts.budgetId, ids))
    : [];

  // Rollover needs every month since the earliest budget started (bounded by
  // how old the budgets are — a handful of rows per budget per month).
  const earliest = rows.reduce(
    (min, r) => (r.startMonth < min ? r.startMonth : min),
    firstOf(month),
  );
  const range = { from: earliest, to: firstOf(addMonths(month, 1)) };
  const [spending, unbudgetedSpendingMinor] = await Promise.all([
    ids.length ? getBudgetMonthlySpending(db, householdId, range) : Promise.resolve([]),
    getUnbudgetedSpending(db, householdId, { from: firstOf(month), to: range.to }),
  ]);

  const result: BudgetDto[] = [];
  for (const row of rows) {
    const spentByMonth = new Map(
      spending.filter((s) => s.budgetId === row.id).map((s) => [s.month, s.spentMinor]),
    );
    const computed = computeBudgetMonth({
      startMonth: row.startMonth,
      amounts: amounts.filter((a) => a.budgetId === row.id),
      rollover: row.rollover,
      spentByMonth,
      month,
    });
    if (!computed) continue; // starts in a later month
    result.push({
      id: row.id,
      categoryId: row.categoryId,
      name: row.name,
      // Subcategories usually have no icon of their own: inherit the parent's.
      icon: row.icon ?? row.parentIcon,
      rollover: row.rollover,
      startMonth: toYearMonth(row.startMonth),
      ...computed,
    });
  }

  // Most urgent first: over, then warning, then ok; within a status, by name.
  result.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status]);

  const sum = (key: "availableMinor" | "spentMinor" | "remainingMinor") =>
    result.reduce((total, b) => total + b[key], 0);
  return {
    month,
    budgets: result,
    totals: {
      availableMinor: sum("availableMinor"),
      spentMinor: sum("spentMinor"),
      remainingMinor: sum("remainingMinor"),
    },
    unbudgetedSpendingMinor,
  };
}

async function getBudgetFor(db: Database, householdId: string, budgetId: string, month: string) {
  const view = await getBudgetMonth(db, householdId, month);
  const budget = view.budgets.find((b) => b.id === budgetId);
  if (!budget) throw notFound("Budget");
  return budget;
}

/**
 * Rules the database can't express on its own:
 *  - only EXPENSE categories can be budgeted;
 *  - a category and its own parent can't BOTH have budgets — the parent's
 *    budget already includes the child's spending, so it would count twice.
 */
async function validateCategory(db: DbExecutor, householdId: string, categoryId: string) {
  const [category] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)));
  if (!category) throw unprocessable("category_not_found", "categoryId", "Category not found.");
  if (category.kind !== "expense") {
    throw unprocessable(
      "budget_category_not_expense",
      "categoryId",
      "Budgets are for spending — pick an expense category.",
    );
  }
  const overlapping = await db
    .select({ name: categories.name })
    .from(budgets)
    .innerJoin(categories, eq(categories.id, budgets.categoryId))
    .where(
      and(
        eq(budgets.householdId, householdId),
        sql`(${categories.id} = ${category.parentId ?? null} or ${categories.parentId} = ${category.id})`,
      ),
    );
  if (overlapping.length > 0) {
    throw unprocessable(
      "budget_overlaps",
      "categoryId",
      `"${overlapping[0]!.name}" already has a budget that includes this category's spending.`,
    );
  }
}

export async function createBudget(db: Database, householdId: string, input: CreateBudgetInput) {
  try {
    const id = await db.transaction(async (tx) => {
      // The overlap rule spans ROWS (a parent's budget and its child's), so no
      // unique index can enforce it. "Check, then insert" alone races: two
      // requests both pass the check. Lock the household's row first, so budget
      // creations in one household take turns (Stage 17). NO KEY UPDATE: rows
      // that merely reference the household (new transactions…) aren't blocked.
      await tx.execute(sql`select 1 from households where id = ${householdId} for no key update`);
      await validateCategory(tx, householdId, input.categoryId);
      const [created] = await tx
        .insert(budgets)
        .values({
          householdId,
          categoryId: input.categoryId,
          startMonth: firstOf(input.startMonth),
          rollover: input.rollover,
        })
        .returning({ id: budgets.id });
      await tx.insert(budgetAmounts).values({
        budgetId: created!.id,
        effectiveMonth: firstOf(input.startMonth),
        amountMinor: input.amountMinor,
      });
      return created!.id;
    });
    return getBudgetFor(db, householdId, id, input.startMonth);
  } catch (error) {
    if (isPgError(error, "uniqueViolation", "budgets_household_category_key")) {
      throw conflict("budget_exists", "This category already has a budget. Edit it instead.");
    }
    throw error;
  }
}

/**
 * Changing the amount never rewrites history: it upserts a row effective FROM
 * `effectiveMonth`, so past months keep reporting what the budget was then.
 */
export async function updateBudget(
  db: Database,
  householdId: string,
  budgetId: string,
  input: UpdateBudgetInput,
) {
  const month = await db.transaction(async (tx) => {
    const [budget] = await tx
      .update(budgets)
      // updated_at is always set, so the SET list is never empty (an amount-only edit still "touches" the budget).
      .set({
        ...(input.rollover !== undefined && { rollover: input.rollover }),
        updatedAt: sql`now()`,
      })
      .where(and(eq(budgets.householdId, householdId), eq(budgets.id, budgetId)))
      .returning();
    if (!budget) throw notFound("Budget");

    if (input.amountMinor !== undefined && input.effectiveMonth !== undefined) {
      // Editing before the start month moves the start back (a budget can't have amounts before it exists).
      const effective = firstOf(input.effectiveMonth);
      if (effective < budget.startMonth) {
        await tx.update(budgets).set({ startMonth: effective }).where(eq(budgets.id, budgetId));
      }
      await tx
        .insert(budgetAmounts)
        .values({ budgetId, effectiveMonth: effective, amountMinor: input.amountMinor })
        .onConflictDoUpdate({
          target: [budgetAmounts.budgetId, budgetAmounts.effectiveMonth],
          set: { amountMinor: input.amountMinor },
        });
    }
    // The month to show the result for: the edited month, else this month (or the start, if later).
    const start = toYearMonth(budget.startMonth);
    const now = new Date().toISOString().slice(0, 7);
    return input.effectiveMonth ?? (start > now ? start : now);
  });
  return getBudgetFor(db, householdId, budgetId, month);
}

export async function deleteBudget(db: Database, householdId: string, budgetId: string) {
  const deleted = await db
    .delete(budgets)
    .where(and(eq(budgets.householdId, householdId), eq(budgets.id, budgetId)))
    .returning({ id: budgets.id });
  if (deleted.length === 0) throw notFound("Budget");
}
