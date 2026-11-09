import { households, sql } from "@ledgerly/db";
import { todayIn, toYearMonth } from "@ledgerly/shared";
import { z } from "zod";
import { defineJob } from "../../jobs/registry.js";
import { enqueue } from "../../jobs/queue.js";

/**
 * The daily re-check that makes "as of today" safe for budget alerts (Stage 19).
 *
 * Budget alerts are queued by a database trigger when a transaction changes. A
 * bill entered on the 9th and dated the 20th changes nothing on the 20th, yet
 * that is the day it starts to count against its budget. With no edit to wake
 * it, the alert would wait for the next unrelated transaction. So, regularly:
 * find households holding an entry that was recorded BEFORE its own date and is
 * dated TODAY (in the household's time zone), and queue the same evaluation the
 * trigger would have. It is safe to repeat: evaluations are keyed per household
 * and month, and each alert is de-duplicated, so nobody is notified twice.
 */
export const evaluateDueBudgetsJob = defineJob({
  name: "budgets.evaluate-due",
  payload: z.object({}),
  run: async (_payload, { db, log }) => {
    // One query per time zone (a handful), not one per household.
    const zones = await db
      .selectDistinct({ timeZone: households.timeZone })
      .from(households)
      .where(sql`exists (select 1 from budgets b where b.household_id = ${households.id})`);

    let queued = 0;
    for (const { timeZone } of zones) {
      const today = todayIn(timeZone);
      const month = toYearMonth(today);
      const { rows } = await db.execute<{ household_id: string }>(sql`
        select distinct h.id as household_id
        from households h
        join transactions t on t.household_id = h.id and t.occurred_on = ${today}::date
        where h.time_zone = ${timeZone}
          and (t.created_at at time zone h.time_zone)::date < t.occurred_on
          and exists (select 1 from budgets b where b.household_id = h.id)`);
      for (const { household_id: householdId } of rows) {
        const id = await enqueue(
          db,
          "budgets.evaluate",
          { householdId, month },
          { singletonKey: `budgets.evaluate:${householdId}:${month}` },
        );
        if (id) queued += 1;
      }
    }
    log.info({ queued }, "Budgets with entries that came due today re-checked");
  },
});
