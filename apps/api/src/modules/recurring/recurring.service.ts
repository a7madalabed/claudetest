import {
  and,
  asc,
  eq,
  households,
  isPgError,
  recurringRules,
  type Database,
  type DbExecutor,
  type RecurringRule,
} from "@ledgerly/db";
import { todayIn, type CreateRecurringRuleInput, type RecurringRuleDto } from "@ledgerly/shared";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";
import { enqueue } from "../../jobs/queue.js";
import { assertUsableAccount, assertUsableCategory } from "../transactions/transactions.service.js";

export const toRuleDto = (row: RecurringRule): RecurringRuleDto => ({
  id: row.id,
  accountId: row.accountId,
  categoryId: row.categoryId,
  description: row.description,
  amountMinor: row.amountMinor,
  cadence: row.cadence,
  daysOfMonth: [row.anchorDay, row.secondDay].filter((d): d is number => d !== null),
  nextDate: row.nextDate,
  active: row.active,
  seriesKey: row.seriesKey,
  createdAt: row.createdAt.toISOString(),
});

export async function listRules(db: DbExecutor, householdId: string) {
  const rows = await db
    .select()
    .from(recurringRules)
    .where(eq(recurringRules.householdId, householdId))
    .orderBy(asc(recurringRules.nextDate));
  return rows.map(toRuleDto);
}

export async function createRule(
  db: Database,
  ctx: { householdId: string; userId: string },
  input: CreateRecurringRuleInput,
) {
  await assertUsableAccount(db, ctx.householdId, input.accountId);
  if (input.categoryId) await assertUsableCategory(db, ctx.householdId, input.categoryId);

  const [household] = await db
    .select({ timeZone: households.timeZone })
    .from(households)
    .where(eq(households.id, ctx.householdId));
  if (input.nextDate < todayIn(household!.timeZone)) {
    throw unprocessable("next_date_in_past", "nextDate", "The first date can't be in the past.");
  }
  const day = Number(input.nextDate.slice(8, 10));
  const days =
    input.cadence === "monthly"
      ? [day]
      : input.cadence === "twice_monthly"
        ? [day, input.secondDay!].sort((a, b) => a - b)
        : [];
  if (input.cadence === "twice_monthly" && days[0] === days[1]) {
    throw unprocessable("same_days", "secondDay", "Pick two different days of the month.");
  }

  try {
    return await db.transaction(async (tx) => {
      const [rule] = await tx
        .insert(recurringRules)
        .values({
          householdId: ctx.householdId,
          accountId: input.accountId,
          categoryId: input.categoryId,
          description: input.description,
          amountMinor: input.amountMinor,
          cadence: input.cadence,
          anchorDay: days[0] ?? null,
          secondDay: days[1] ?? null,
          nextDate: input.nextDate,
          seriesKey: input.seriesKey ?? null,
          createdBy: ctx.userId,
        })
        .returning();
      // If it's due today, don't wait for the next scheduled run.
      await enqueue(
        tx,
        "recurring.run-due",
        { householdId: ctx.householdId },
        { singletonKey: `recurring:${ctx.householdId}` },
      );
      return toRuleDto(rule!);
    });
  } catch (error) {
    if (isPgError(error, "uniqueViolation", "recurring_rules_household_series_key")) {
      throw conflict("rule_exists", "This bill is already automated.");
    }
    throw error;
  }
}

export async function setRuleActive(
  db: DbExecutor,
  householdId: string,
  ruleId: string,
  active: boolean,
) {
  const [rule] = await db
    .update(recurringRules)
    .set({ active })
    .where(and(eq(recurringRules.householdId, householdId), eq(recurringRules.id, ruleId)))
    .returning();
  if (!rule) throw notFound("Recurring rule");
  return toRuleDto(rule);
}

/** Deleting a rule keeps the transactions it already created (their rule link is cleared). */
export async function deleteRule(db: DbExecutor, householdId: string, ruleId: string) {
  const deleted = await db
    .delete(recurringRules)
    .where(and(eq(recurringRules.householdId, householdId), eq(recurringRules.id, ruleId)))
    .returning({ id: recurringRules.id });
  if (deleted.length === 0) throw notFound("Recurring rule");
}
