import { accounts, eq, recurringRules, transactions } from "@ledgerly/db";
import { nextRecurringDate, todayIn } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import { OWNER, jobRunner, request, useTestApp } from "../../test/helpers.js";

const ZONE = "America/Los_Angeles"; // the demo household's time zone
const daysAgo = (n: number) =>
  new Date(Date.parse(`${todayIn(ZONE)}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

describe("recurring rules", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const checkingId = async () =>
    (await request(ctx.app, OWNER, { method: "GET", url: `${base()}/accounts` }))
      .json()
      .data.find((a: { name: string }) => a.name === "Everyday Checking").id;
  const create = async (body: Record<string, unknown>) =>
    request(ctx.app, OWNER, {
      method: "POST",
      url: `${base()}/recurring-rules`,
      payload: { accountId: await checkingId(), description: "Gym", amountMinor: -4_000, ...body },
    });
  const ruleTransactions = (ruleId: string) =>
    ctx.db.select().from(transactions).where(eq(transactions.recurringRuleId, ruleId));

  it("creates today's transaction right away and schedules the next", async () => {
    const response = await create({ cadence: "monthly", nextDate: todayIn(ZONE) });
    expect(response.statusCode).toBe(201);
    const rule = response.json();
    await jobRunner(ctx.db).run();

    const created = await ruleTransactions(rule.id);
    expect(created.map((t) => [t.occurredOn, t.amountMinor])).toEqual([[todayIn(ZONE), -4_000]]);
    const [stored] = await ctx.db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, rule.id));
    expect(stored!.nextDate).toBe(nextRecurringDate(stored!, todayIn(ZONE)));
  });

  it("catches up on missed dates, each on its own day, without duplicates", async () => {
    const rule = (await create({ cadence: "weekly", nextDate: todayIn(ZONE) })).json();
    // Pretend the worker was down for three weeks.
    await ctx.db
      .update(recurringRules)
      .set({ nextDate: daysAgo(21) })
      .where(eq(recurringRules.id, rule.id));
    await jobRunner(ctx.db).run();
    const dates = (await ruleTransactions(rule.id)).map((t) => t.occurredOn).sort();
    expect(dates).toEqual([daysAgo(21), daysAgo(14), daysAgo(7), daysAgo(0)]);

    // A retry after a crash (next_date not yet advanced) must not duplicate anything.
    await ctx.db
      .update(recurringRules)
      .set({ nextDate: daysAgo(21) })
      .where(eq(recurringRules.id, rule.id));
    await request(ctx.app, OWNER, {
      method: "PATCH",
      url: `${base()}/recurring-rules/${rule.id}`,
      payload: { active: true },
    });
    const runner = jobRunner(ctx.db);
    await create({ cadence: "monthly", nextDate: todayIn(ZONE), description: "Other" }); // queues a run
    await runner.run();
    expect(await ruleTransactions(rule.id)).toHaveLength(4);
  });

  it("does nothing while paused", async () => {
    const rule = (await create({ cadence: "monthly", nextDate: todayIn(ZONE) })).json();
    await request(ctx.app, OWNER, {
      method: "PATCH",
      url: `${base()}/recurring-rules/${rule.id}`,
      payload: { active: false },
    });
    await jobRunner(ctx.db).run();
    expect(await ruleTransactions(rule.id)).toHaveLength(0);
  });

  it("pauses itself (and says why) when its account is archived", async () => {
    const rule = (await create({ cadence: "monthly", nextDate: todayIn(ZONE) })).json();
    await ctx.db
      .update(accounts)
      .set({ archivedAt: new Date() })
      .where(eq(accounts.id, rule.accountId));
    await jobRunner(ctx.db).run();
    const [stored] = await ctx.db
      .select()
      .from(recurringRules)
      .where(eq(recurringRules.id, rule.id));
    expect(stored!.active).toBe(false);
    const list = (
      await request(ctx.app, OWNER, { method: "GET", url: "/v1/notifications" })
    ).json();
    expect(list.data.some((n: { kind: string }) => n.kind === "recurring.paused")).toBe(true);
  });

  it("validates rules", async () => {
    expect((await create({ cadence: "monthly", nextDate: "2020-01-01" })).json().code).toBe(
      "next_date_in_past",
    );
    expect((await create({ cadence: "twice_monthly", nextDate: todayIn(ZONE) })).statusCode).toBe(
      400,
    );
    await create({ cadence: "monthly", nextDate: todayIn(ZONE), seriesKey: "gym|out" });
    expect(
      (await create({ cadence: "monthly", nextDate: todayIn(ZONE), seriesKey: "gym|out" }))
        .statusCode,
    ).toBe(409);
  });

  it("links detected bills to the rule that automates them", async () => {
    const report = async () =>
      (
        await request(ctx.app, OWNER, {
          method: "GET",
          url: `${base()}/reports/recurring?today=2026-06-15`,
        })
      ).json().series;
    const rent = (await report()).find((s: { description: string }) =>
      s.description.startsWith("Rent"),
    );
    expect(rent.ruleId).toBeNull();
    const rule = (
      await create({
        cadence: "monthly",
        nextDate: todayIn(ZONE),
        description: rent.description,
        amountMinor: rent.amountMinor,
        seriesKey: rent.key,
      })
    ).json();
    expect((await report()).find((s: { key: string }) => s.key === rent.key).ruleId).toBe(rule.id);
  });
});
