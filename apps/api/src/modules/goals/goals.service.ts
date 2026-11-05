import {
  accounts,
  and,
  asc,
  eq,
  getAccountMonthEndBalances,
  goals,
  households,
  type Database,
} from "@ledgerly/db";
import {
  addMonths,
  projectGoal,
  todayIn,
  toYearMonth,
  type CreateGoalInput,
  type GoalDto,
  type UpdateGoalInput,
} from "@ledgerly/shared";
import { notFound, unprocessable } from "../../lib/errors.js";

/** 6 month-over-month changes need 7 COMPLETED month-ends (+ this month for today's balance). */
const COMPLETED_MONTHS = 7;

/** Today in the HOUSEHOLD's time zone (Stage 17): a goal's month-ends are its months. */
async function householdToday(db: Database, householdId: string) {
  const [household] = await db
    .select({ timeZone: households.timeZone })
    .from(households)
    .where(eq(households.id, householdId));
  return todayIn(household?.timeZone ?? "UTC");
}

async function withProjection(
  db: Database,
  householdId: string,
  goal: typeof goals.$inferSelect & { accountName: string; currency: string },
  onDate: string,
): Promise<GoalDto> {
  const month = toYearMonth(onDate);
  const history = await getAccountMonthEndBalances(db, householdId, goal.accountId, {
    from: `${addMonths(month, -COMPLETED_MONTHS)}-01`,
    to: `${addMonths(month, 1)}-01`,
  });
  // The last point is THIS month (in progress): it's the current balance, but it
  // would drag the pace down mid-month, so the pace uses completed months only.
  const balanceMinor = history.at(-1)?.balanceMinor ?? 0;
  const projection = projectGoal({
    balanceMinor,
    targetMinor: goal.targetMinor,
    targetDate: goal.targetDate,
    monthEndBalances: history.slice(0, -1).map((h) => h.balanceMinor),
    today: onDate,
  });
  return {
    id: goal.id,
    name: goal.name,
    accountId: goal.accountId,
    accountName: goal.accountName,
    currency: goal.currency,
    targetMinor: goal.targetMinor,
    targetDate: goal.targetDate,
    balanceMinor,
    ...projection,
    createdAt: goal.createdAt.toISOString(),
  };
}

const selectGoals = (db: Database, householdId: string, goalId?: string) =>
  db
    .select({ goal: goals, accountName: accounts.name, currency: accounts.currency })
    .from(goals)
    .innerJoin(accounts, eq(accounts.id, goals.accountId))
    .where(and(eq(goals.householdId, householdId), goalId ? eq(goals.id, goalId) : undefined));

export async function listGoals(db: Database, householdId: string, onDate: string) {
  const rows = await selectGoals(db, householdId).orderBy(asc(goals.createdAt));
  // One small query per goal: households have a handful of goals, so this is fine
  // (and simpler than one giant query). Run them concurrently.
  return Promise.all(
    rows.map((r) =>
      withProjection(
        db,
        householdId,
        { ...r.goal, accountName: r.accountName, currency: r.currency },
        onDate,
      ),
    ),
  );
}

async function getGoal(db: Database, householdId: string, goalId: string) {
  const [row] = await selectGoals(db, householdId, goalId);
  if (!row) throw notFound("Goal");
  return withProjection(
    db,
    householdId,
    { ...row.goal, accountName: row.accountName, currency: row.currency },
    await householdToday(db, householdId),
  );
}

export async function createGoal(db: Database, householdId: string, input: CreateGoalInput) {
  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, input.accountId)));
  if (!account) throw unprocessable("account_not_found", "accountId", "Account not found.");
  const [created] = await db
    .insert(goals)
    .values({ householdId, ...input })
    .returning({ id: goals.id });
  return getGoal(db, householdId, created!.id);
}

export async function updateGoal(
  db: Database,
  householdId: string,
  goalId: string,
  input: UpdateGoalInput,
) {
  const updated = await db
    .update(goals)
    .set(input)
    .where(and(eq(goals.householdId, householdId), eq(goals.id, goalId)))
    .returning({ id: goals.id });
  if (updated.length === 0) throw notFound("Goal");
  return getGoal(db, householdId, goalId);
}

export async function deleteGoal(db: Database, householdId: string, goalId: string) {
  const deleted = await db
    .delete(goals)
    .where(and(eq(goals.householdId, householdId), eq(goals.id, goalId)))
    .returning({ id: goals.id });
  if (deleted.length === 0) throw notFound("Goal");
}
