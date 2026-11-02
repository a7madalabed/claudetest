import { categories, eq, jobs, transactions } from "@ledgerly/db";
import { todayIn } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import { OWNER, VIEWER, jobRunner, request, useTestApp } from "../../test/helpers.js";

describe("budget notifications", () => {
  const ctx = useTestApp();

  /** Records an expense TODAY (in the household's time zone) in Entertainment › Events. */
  async function spend(amountMinor: number) {
    const [events] = await ctx.db.select().from(categories).where(eq(categories.name, "Events"));
    const accounts = (
      await request(ctx.app, OWNER, {
        method: "GET",
        url: `/v1/households/${ctx.fixtures.householdId}/accounts`,
      })
    ).json().data;
    return request(ctx.app, OWNER, {
      method: "POST",
      url: `/v1/households/${ctx.fixtures.householdId}/transactions`,
      payload: {
        accountId: accounts[0].id,
        categoryId: events!.id,
        amountMinor: -amountMinor,
        occurredOn: todayIn("America/Los_Angeles"),
        description: "Concert",
      },
    });
  }
  const list = async (user: string) =>
    (await request(ctx.app, user, { method: "GET", url: "/v1/notifications" })).json();

  it("a transaction queues an evaluation; going over notifies every member once, by email too", async () => {
    expect((await spend(50_000)).statusCode).toBe(201);
    // The database trigger queued the job (debounced, a couple of seconds out).
    const [queued] = await ctx.db.select().from(jobs).where(eq(jobs.name, "budgets.evaluate"));
    expect(queued).toBeDefined();

    const runner = jobRunner(ctx.db);
    await runner.run();
    for (const user of [OWNER, VIEWER]) {
      const { data, unreadCount } = await list(user);
      expect(unreadCount).toBe(1);
      expect(data[0]).toMatchObject({
        kind: "budget.over",
        title: "Entertainment is over budget",
        link: `/app/${ctx.fixtures.householdId}/budgets`,
      });
    }
    // Every member — including Jamie, the seeded partner.
    expect(runner.mailer.sent.map((m) => m.to).sort()).toEqual(
      [OWNER, "jamie@ledgerly.app", VIEWER].sort(),
    );
    expect(runner.mailer.sent[0]!.text).toContain("http://localhost:3000/app/");

    // More spending, another evaluation: still ONE "over" notification per person.
    await spend(1_000);
    await jobRunner(ctx.db).run();
    expect((await list(OWNER)).unreadCount).toBe(1);
  });

  it("stays quiet while budgets are on track", async () => {
    await spend(100);
    await jobRunner(ctx.db).run();
    expect((await list(OWNER)).data).toEqual([]);
  });

  it("ignores changes to past months", async () => {
    const [events] = await ctx.db.select().from(categories).where(eq(categories.name, "Events"));
    await ctx.db
      .update(transactions)
      .set({ amountMinor: -999_999 })
      .where(eq(transactions.categoryId, events!.id));
    expect(await ctx.db.select().from(jobs)).toHaveLength(0); // fixture data is all in the past
  });

  it("marks notifications as read", async () => {
    await spend(50_000);
    await jobRunner(ctx.db).run();
    const marked = await request(ctx.app, OWNER, {
      method: "POST",
      url: "/v1/notifications/read",
      payload: {},
    });
    expect(marked.json().unreadCount).toBe(0);
    expect((await list(VIEWER)).unreadCount).toBe(1); // someone else's are untouched
  });
});
