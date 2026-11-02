import { accounts, and, eq, households, recurringRules, sql, transactions } from "@ledgerly/db";
import { formatMoney, nextRecurringDate, todayIn } from "@ledgerly/shared";
import { z } from "zod";
import { defineJob } from "../../jobs/registry.js";
import { notify } from "../notifications/notifications.service.js";

/** A rule paused for a year creates at most this many catch-up transactions. */
const MAX_CATCH_UP = 60;

/**
 * Creates the transactions that recurring rules say are due — on a schedule
 * (every 15 minutes) and right after a rule is created.
 *
 * Robust by construction:
 *  - "Due" means on or before TODAY IN THE HOUSEHOLD'S TIME ZONE.
 *  - CATCH-UP: if the worker was down for three days, the next run creates all
 *    three days' transactions, each on its own correct date.
 *  - Each rule is processed in its own transaction with its row locked
 *    (SKIP LOCKED: two workers never process the same rule).
 *  - The unique (rule, date) index means even a crash between "insert" and
 *    "advance next_date" can't create a duplicate on the retry.
 */
export const runDueRecurringJob = defineJob({
  name: "recurring.run-due",
  payload: z.object({ householdId: z.uuid().optional() }),
  leaseSeconds: 120,
  run: async ({ householdId }, { db, log }) => {
    const due = await db
      .select({ id: recurringRules.id })
      .from(recurringRules)
      .innerJoin(households, eq(households.id, recurringRules.householdId))
      .where(
        and(
          eq(recurringRules.active, true),
          sql`${recurringRules.nextDate} <= (now() at time zone ${households.timeZone})::date`,
          householdId ? eq(recurringRules.householdId, householdId) : undefined,
        ),
      )
      .limit(1_000);

    let created = 0;
    for (const { id } of due) {
      created += await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            rule: recurringRules,
            timeZone: households.timeZone,
            currency: accounts.currency,
            accountArchived: accounts.archivedAt,
          })
          .from(recurringRules)
          .innerJoin(households, eq(households.id, recurringRules.householdId))
          .innerJoin(accounts, eq(accounts.id, recurringRules.accountId))
          .where(and(eq(recurringRules.id, id), eq(recurringRules.active, true)))
          .for("update", { of: recurringRules, skipLocked: true });
        if (!row) return 0; // another worker has it, or it was paused/deleted meanwhile
        const { rule } = row;

        if (row.accountArchived) {
          // The money can't go into an archived account: pause the rule and say why.
          await tx.update(recurringRules).set({ active: false }).where(eq(recurringRules.id, id));
          await notify(tx, {
            householdId: rule.householdId,
            kind: "recurring.paused",
            title: `"${rule.description}" was paused`,
            body: "Its account is archived, so no more transactions will be created.",
            link: `/app/${rule.householdId}/budgets`,
            dedupeKey: `recurring:${id}:paused`,
          });
          return 0;
        }

        const today = todayIn(row.timeZone);
        const dates: string[] = [];
        let next = rule.nextDate;
        while (next <= today && dates.length < MAX_CATCH_UP) {
          dates.push(next);
          next = nextRecurringDate(rule, next);
        }
        if (dates.length === 0) return 0;

        const inserted = await tx
          .insert(transactions)
          .values(
            dates.map((occurredOn) => ({
              householdId: rule.householdId,
              accountId: rule.accountId,
              categoryId: rule.categoryId,
              amountMinor: rule.amountMinor,
              occurredOn,
              description: rule.description,
              recurringRuleId: rule.id,
              createdBy: rule.createdBy,
            })),
          )
          .onConflictDoNothing({
            target: [transactions.recurringRuleId, transactions.occurredOn],
            where: sql`recurring_rule_id is not null`,
          })
          .returning({ id: transactions.id });
        await tx.update(recurringRules).set({ nextDate: next }).where(eq(recurringRules.id, id));

        if (inserted.length > 0) {
          await notify(tx, {
            householdId: rule.householdId,
            kind: "recurring.created",
            title: `Recorded ${rule.description}`,
            body: `${formatMoney(rule.amountMinor, row.currency)}${inserted.length > 1 ? ` × ${inserted.length}` : ""}, as scheduled.`,
            link: `/app/${rule.householdId}/transactions`,
            dedupeKey: `recurring:${id}:${dates.at(-1)}`,
          });
        }
        return inserted.length;
      });
    }
    log.info({ rules: due.length, created }, "Recurring rules processed");
  },
});
