import { expect, test, today } from "../src/fixtures.js";

test.describe("the month statement", () => {
  test("a bill dated tomorrow doesn't change today's figures, and no money is invented", async ({
    page,
    user,
    account,
    userApi,
  }) => {
    // The account opens with $2,500.00. Coffee today; rent dated tomorrow.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    for (const [amountMinor, occurredOn, description] of [
      [-5_000, today(), "Coffee"],
      [-150_000, tomorrow, "Rent, dated tomorrow"],
    ] as const) {
      await userApi.post(`/households/${user.householdId}/transactions`, {
        accountId: account.id,
        amountMinor,
        occurredOn,
        description,
      });
    }

    await page.goto(user.home);
    const statement = page.locator("section[aria-labelledby=this-month]");
    // $2,500.00 brought forward − $50.00 spent = $2,450.00. Tomorrow's rent hasn't happened.
    await expect(statement).toContainText("Brought forward");
    await expect(statement.getByText("$2,500.00").first()).toBeVisible();
    await expect(statement.getByText("−$50.00").first()).toBeVisible();
    await expect(statement.getByText("$2,450.00").first()).toBeVisible();
    // This page once showed "Net worth −$550" and an invented "Accounts added or adjusted −$1,500".
    await expect(statement).not.toContainText("adjusted");
    await expect(statement).not.toContainText("$1,500.00");
  });
});
