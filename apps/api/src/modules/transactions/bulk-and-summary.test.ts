import { count, eq, transactions } from "@ledgerly/db";
import type { TransactionDto } from "@ledgerly/shared";
import { v7 as uuidv7 } from "uuid";
import { describe, expect, it } from "vitest";
import { OUTSIDER, OWNER, VIEWER, request, useTestApp } from "../../test/helpers.js";

describe("Stage 7 transaction features", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const as = (method: "GET" | "POST", path: string, payload?: object) =>
    request(ctx.app, OWNER, { method, url: `${base()}${path}`, ...(payload && { payload }) });
  const firstAccount = async () => (await as("GET", "/accounts")).json().data[0] as { id: string };
  const categoryId = async (name: string) =>
    (await as("GET", "/categories")).json().data.find((c: { name: string }) => c.name === name)
      .id as string;

  describe("client-generated ids", () => {
    it("uses the id the client chose (so an optimistic row keeps its identity)", async () => {
      const id = uuidv7();
      const account = await firstAccount();
      const response = await as("POST", "/transactions", {
        id,
        accountId: account.id,
        amountMinor: -1234,
        occurredOn: "2026-06-15",
        description: "Optimistic coffee",
      });
      expect(response.statusCode).toBe(201);
      expect(response.json().id).toBe(id);
    });

    it("never overwrites: reusing an existing id is a 409", async () => {
      const account = await firstAccount();
      const body = {
        id: uuidv7(),
        accountId: account.id,
        amountMinor: -100,
        occurredOn: "2026-06-15",
        description: "x",
      };
      await as("POST", "/transactions", body);
      const again = await as("POST", "/transactions", {
        ...body,
        description: "overwrite attempt",
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().code).toBe("transaction_exists");
    });
  });

  describe("summary", () => {
    it("matches the list exactly for the same filters", async () => {
      const filter = "type=expense&from=2026-05-01&to=2026-06-01";
      const summary = (await as("GET", `/transactions/summary?${filter}`)).json();
      const rows: TransactionDto[] = (await as("GET", `/transactions?${filter}&limit=200`)).json()
        .data;
      expect(summary.count).toBe(rows.length);
      expect(summary.spendingMinor).toBe(-rows.reduce((sum, t) => sum + t.amountMinor, 0));
      expect(summary.incomeMinor).toBe(0);
    });

    it("counts transfers but excludes them from income and spending", async () => {
      const summary = (await as("GET", "/transactions/summary?type=transfer")).json();
      expect(summary.count).toBeGreaterThan(0);
      expect(summary).toMatchObject({ incomeMinor: 0, spendingMinor: 0 });
    });
  });

  describe("bulk actions", () => {
    it("re-categorises many rows at once and skips transfers", async () => {
      const { data } = (await as("GET", "/transactions?limit=40")).json();
      const ids = data.map((t: TransactionDto) => t.id);
      const transfers = data.filter((t: TransactionDto) => t.transferId).length;
      const shopping = await categoryId("Shopping");

      const result = (
        await as("POST", "/transactions/bulk", { action: "categorize", ids, categoryId: shopping })
      ).json();
      expect(result).toEqual({ affected: ids.length - transfers, skipped: transfers });
      const after = (await as("GET", `/transactions?categoryId=${shopping}&limit=200`)).json().data;
      expect(after.length).toBeGreaterThanOrEqual(ids.length - transfers);
    });

    it("deletes atomically, taking both halves of a transfer", async () => {
      const [half] = (await as("GET", "/transactions?type=transfer&limit=1")).json().data;
      const [expense] = (await as("GET", "/transactions?type=expense&limit=1")).json().data;
      const result = (
        await as("POST", "/transactions/bulk", { action: "delete", ids: [half.id, expense.id] })
      ).json();
      expect(result).toEqual({ affected: 3, skipped: 0 });
      const left = await ctx.db
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.transferId, half.transferId));
      expect(left[0]!.n).toBe(0);
    });

    it("never touches another household's rows", async () => {
      const otherAccount = (
        await request(ctx.app, OUTSIDER, {
          method: "POST",
          url: `/v1/households/${ctx.fixtures.otherHouseholdId}/accounts`,
          payload: { name: "Otto cash", type: "cash", currency: "USD" },
        })
      ).json();
      const theirs = (
        await request(ctx.app, OUTSIDER, {
          method: "POST",
          url: `/v1/households/${ctx.fixtures.otherHouseholdId}/transactions`,
          payload: {
            accountId: otherAccount.id,
            amountMinor: -500,
            occurredOn: "2026-06-01",
            description: "Mine!",
          },
        })
      ).json();

      const result = (
        await as("POST", "/transactions/bulk", { action: "delete", ids: [theirs.id] })
      ).json();
      expect(result).toEqual({ affected: 0, skipped: 1 });
      const still = await ctx.db.select().from(transactions).where(eq(transactions.id, theirs.id));
      expect(still).toHaveLength(1);
    });

    it("viewers can't run bulk actions", async () => {
      const response = await request(ctx.app, VIEWER, {
        method: "POST",
        url: `${base()}/transactions/bulk`,
        payload: { action: "delete", ids: [uuidv7()] },
      });
      expect(response.statusCode).toBe(403);
    });
  });
});
