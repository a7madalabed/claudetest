import { getAccountBalances } from "@ledgerly/db";
import { describe, expect, it } from "vitest";
import { OWNER, request, useTestApp } from "../../test/helpers.js";

describe("accounts", () => {
  const ctx = useTestApp();
  const url = (path = "") => `/v1/households/${ctx.fixtures.householdId}/accounts${path}`;
  const as = (method: "GET" | "POST" | "PATCH" | "DELETE", path = "", payload?: object) =>
    request(ctx.app, OWNER, { method, url: url(path), ...(payload && { payload }) });

  it("lists accounts with balances matching the database", async () => {
    const response = await as("GET");
    expect(response.statusCode).toBe(200);
    const expected = await getAccountBalances(ctx.db, ctx.fixtures.householdId);
    expect(
      response
        .json()
        .data.map((a: { name: string; balanceMinor: number }) => [a.name, a.balanceMinor]),
    ).toEqual(expected.map((a) => [a.name, a.balanceMinor]));
  });

  it("creates an account: 201 + Location header", async () => {
    const response = await as("POST", "", {
      name: "  Brokerage  ",
      type: "investment",
      currency: "USD",
      openingBalanceMinor: 500_000,
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ name: "Brokerage", balanceMinor: 500_000, archived: false }); // name was trimmed
    expect(response.headers.location).toBe(url(`/${body.id}`));
  });

  it("returns every validation problem at once, with field paths", async () => {
    const response = await as("POST", "", { name: "", type: "piggy-bank", currency: "usd" });
    expect(response.statusCode).toBe(400);
    const paths = response.json().errors.map((error: { path: string }) => error.path);
    expect(paths).toEqual(expect.arrayContaining(["body.name", "body.type", "body.currency"]));
  });

  it("409 on a duplicate name", async () => {
    const response = await as("POST", "", { name: "Cash", type: "cash", currency: "USD" });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe("account_name_taken");
  });

  it("uses the household's currency, and refuses any other (Stage 16)", async () => {
    // Totals add up amounts across accounts: ¥10,000 is not $100.00. Until
    // amounts are converted, a household keeps its books in ONE currency.
    const defaulted = await as("POST", "", { name: "Wallet", type: "cash" });
    expect(defaulted.statusCode).toBe(201);
    expect(defaulted.json().currency).toBe("USD");

    const other = await as("POST", "", { name: "Yen", type: "cash", currency: "JPY" });
    expect(other.statusCode).toBe(422);
    expect(other.json().code).toBe("currency_not_supported");
  });

  it("archiving hides an account unless includeArchived=true", async () => {
    const [cash] = (await as("GET")).json().data.filter((a: { name: string }) => a.name === "Cash");
    const patched = await as("PATCH", `/${cash.id}`, { archived: true });
    expect(patched.json().archived).toBe(true);
    expect((await as("GET")).json().data.map((a: { id: string }) => a.id)).not.toContain(cash.id);
    expect(
      (await as("GET", "?includeArchived=true")).json().data.map((a: { id: string }) => a.id),
    ).toContain(cash.id);
  });

  it("refuses to delete an account with history (409), deletes an empty one (204)", async () => {
    const [checking] = (await as("GET")).json().data;
    const blocked = await as("DELETE", `/${checking.id}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe("account_has_transactions");

    const created = (await as("POST", "", { name: "Temp", type: "cash", currency: "USD" })).json();
    expect((await as("DELETE", `/${created.id}`)).statusCode).toBe(204);
    expect((await as("GET", `/${created.id}`)).statusCode).toBe(404);
  });

  it("rejects an empty PATCH", async () => {
    const [account] = (await as("GET")).json().data;
    expect((await as("PATCH", `/${account.id}`, {})).statusCode).toBe(400);
  });
});
