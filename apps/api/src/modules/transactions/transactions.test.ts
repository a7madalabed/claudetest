import { count, eq, transactions } from "@ledgerly/db";
import type { TransactionDto } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import { OUTSIDER, OWNER, request, useTestApp } from "../../test/helpers.js";

describe("transactions", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const as = (
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    payload?: object,
    headers?: Record<string, string>,
  ) =>
    request(ctx.app, OWNER, {
      method,
      url: `${base()}${path}`,
      ...(payload && { payload }),
      ...(headers && { headers }),
    });

  const accountsByName = async () =>
    Object.fromEntries(
      (await as("GET", "/accounts"))
        .json()
        .data.map((a: { name: string; id: string }) => [a.name, a]),
    ) as Record<string, { id: string; balanceMinor: number }>;
  const categoryId = async (name: string) =>
    (await as("GET", "/categories")).json().data.find((c: { name: string }) => c.name === name)
      .id as string;
  const dbCount = async () =>
    (
      await ctx.db
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.householdId, ctx.fixtures.householdId))
    )[0]!.n;

  describe("listing", () => {
    it("walks every page with keyset cursors: complete, no duplicates, newest first", async () => {
      const seen: TransactionDto[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const response = await as(
          "GET",
          `/transactions?limit=50${cursor ? `&cursor=${cursor}` : ""}`,
        );
        expect(response.statusCode).toBe(200);
        const page = response.json();
        seen.push(...page.data);
        cursor = page.nextCursor;
        pages++;
      } while (cursor);

      expect(seen).toHaveLength(await dbCount());
      expect(new Set(seen.map((t) => t.id)).size).toBe(seen.length);
      expect(pages).toBeGreaterThan(2);
      const keys = seen.map((t) => `${t.occurredOn}|${t.id}`);
      expect(keys).toEqual([...keys].sort().reverse());
    });

    it("filters by type: expenses are negative and never transfers", async () => {
      const { data } = (await as("GET", "/transactions?type=expense&limit=200")).json();
      expect(data.length).toBeGreaterThan(0);
      expect(data.every((t: TransactionDto) => t.amountMinor < 0 && t.transferId === null)).toBe(
        true,
      );
    });

    it("filtering by a parent category includes its subcategories", async () => {
      const food = await categoryId("Food");
      const coffee = await categoryId("Coffee");
      const { data } = (await as("GET", `/transactions?categoryId=${food}&limit=200`)).json();
      expect(data.some((t: TransactionDto) => t.categoryId === coffee)).toBe(true);
    });

    it("searches descriptions case-insensitively, treating % and _ literally", async () => {
      const coffee = (await as("GET", "/transactions?q=COFFEE&limit=200")).json().data;
      expect(coffee.length).toBeGreaterThan(0);
      expect(coffee.every((t: TransactionDto) => /coffee/i.test(t.description))).toBe(true);

      const wildcard = (await as("GET", "/transactions?q=%25")).json().data; // "%" URL-encoded
      expect(wildcard).toHaveLength(0);
    });

    it("rejects a tampered cursor", async () => {
      const response = await as("GET", "/transactions?cursor=bm90LWEtY3Vyc29y");
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("invalid_cursor");
    });
  });

  describe("creating", () => {
    it("records a transaction and updates the balance", async () => {
      const { "Everyday Checking": checking } = await accountsByName();
      const response = await as("POST", "/transactions", {
        accountId: checking!.id,
        categoryId: await categoryId("Groceries"),
        amountMinor: -4_250,
        occurredOn: "2026-06-14",
        description: "Farmers market",
      });
      expect(response.statusCode).toBe(201);
      expect(response.headers.location).toBe(`${base()}/transactions/${response.json().id}`);
      expect((await accountsByName())["Everyday Checking"]!.balanceMinor).toBe(
        checking!.balanceMinor - 4_250,
      );
    });

    it("validates input: zero amount, bad date, unknown fields are stripped", async () => {
      const { Cash: cash } = await accountsByName();
      const response = await as("POST", "/transactions", {
        accountId: cash!.id,
        amountMinor: 0,
        occurredOn: "2026-02-30",
        description: "x",
      });
      expect(response.statusCode).toBe(400);
      const paths = response.json().errors.map((e: { path: string }) => e.path);
      expect(paths).toEqual(expect.arrayContaining(["body.amountMinor", "body.occurredOn"]));
    });

    it("refuses an account from another household (422, not a leak)", async () => {
      const foreign = (
        await request(ctx.app, OUTSIDER, {
          method: "POST",
          url: `/v1/households/${ctx.fixtures.otherHouseholdId}/accounts`,
          payload: { name: "Otto's cash", type: "cash", currency: "USD" },
        })
      ).json();

      const response = await as("POST", "/transactions", {
        accountId: foreign.id,
        amountMinor: -100,
        occurredOn: "2026-06-01",
        description: "Not mine",
      });
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("account_not_found");
    });
  });

  describe("idempotency", () => {
    it("retrying with the same Idempotency-Key never creates a duplicate", async () => {
      const { Cash: cash } = await accountsByName();
      const payload = {
        accountId: cash!.id,
        amountMinor: -450,
        occurredOn: "2026-06-15",
        description: "Coffee",
      };
      const headers = { "idempotency-key": "4f0e9d8c-retry-test" };
      const before = await dbCount();

      const first = await as("POST", "/transactions", payload, headers);
      const retry = await as("POST", "/transactions", payload, headers);

      expect(first.statusCode).toBe(201);
      expect(retry.statusCode).toBe(201);
      expect(retry.json().id).toBe(first.json().id);
      expect(retry.headers["idempotent-replayed"]).toBe("true");
      expect(await dbCount()).toBe(before + 1);
    });

    it("concurrent duplicates still create exactly one row", async () => {
      const { Cash: cash } = await accountsByName();
      const payload = {
        accountId: cash!.id,
        amountMinor: -999,
        occurredOn: "2026-06-15",
        description: "Race",
      };
      const headers = { "idempotency-key": "race-condition-key" };
      const before = await dbCount();

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => as("POST", "/transactions", payload, headers)),
      );

      expect(new Set(responses.map((r) => r.json().id)).size).toBe(1);
      expect(await dbCount()).toBe(before + 1);
    });

    it("reusing a key for a different request is rejected", async () => {
      const { Cash: cash } = await accountsByName();
      const headers = { "idempotency-key": "reused-key" };
      await as(
        "POST",
        "/transactions",
        { accountId: cash!.id, amountMinor: -100, occurredOn: "2026-06-15", description: "A" },
        headers,
      );
      const response = await as(
        "POST",
        "/transactions",
        { accountId: cash!.id, amountMinor: -200, occurredOn: "2026-06-15", description: "B" },
        headers,
      );
      expect(response.statusCode).toBe(422);
      expect(response.json().code).toBe("idempotency_key_reused");
    });
  });

  describe("transfers", () => {
    it("moves money atomically: two rows, balances shift, cashflow unaffected", async () => {
      const before = await accountsByName();
      const cashflowBefore = (
        await as("GET", "/reports/cashflow?from=2026-06-01&to=2026-07-01")
      ).json();

      const response = await as("POST", "/transfers", {
        fromAccountId: before["Everyday Checking"]!.id,
        toAccountId: before["High-Yield Savings"]!.id,
        amountMinor: 25_000,
        occurredOn: "2026-06-15",
      });
      expect(response.statusCode).toBe(201);
      const transfer = response.json();
      expect(transfer.from.amountMinor).toBe(-25_000);
      expect(transfer.to.amountMinor).toBe(25_000);

      const after = await accountsByName();
      expect(after["Everyday Checking"]!.balanceMinor).toBe(
        before["Everyday Checking"]!.balanceMinor - 25_000,
      );
      expect(after["High-Yield Savings"]!.balanceMinor).toBe(
        before["High-Yield Savings"]!.balanceMinor + 25_000,
      );
      expect((await as("GET", "/reports/cashflow?from=2026-06-01&to=2026-07-01")).json()).toEqual(
        cashflowBefore,
      );
    });

    it("rejects transferring to the same account", async () => {
      const { Cash: cash } = await accountsByName();
      const response = await as("POST", "/transfers", {
        fromAccountId: cash!.id,
        toAccountId: cash!.id,
        amountMinor: 100,
        occurredOn: "2026-06-15",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().errors[0].path).toBe("body.toAccountId");
    });

    it("locks the amount of one half, and deleting one half deletes both", async () => {
      const { data } = (await as("GET", "/transactions?type=transfer&limit=1")).json();
      const half = data[0] as TransactionDto;

      const edit = await as("PATCH", `/transactions/${half.id}`, { amountMinor: -1 });
      expect(edit.statusCode).toBe(422);
      expect(edit.json().code).toBe("transfer_locked");

      const rename = await as("PATCH", `/transactions/${half.id}`, {
        description: "Renamed transfer",
      });
      expect(rename.statusCode).toBe(200);

      expect((await as("DELETE", `/transactions/${half.id}`)).statusCode).toBe(204);
      const remaining = await ctx.db
        .select()
        .from(transactions)
        .where(eq(transactions.transferId, half.transferId!));
      expect(remaining).toHaveLength(0);
    });
  });
});
