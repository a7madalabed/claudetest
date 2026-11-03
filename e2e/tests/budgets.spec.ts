import type { TransactionDto } from "@ledgerly/shared";
import { expect, test, today } from "../src/fixtures.js";

test.describe("budgets", () => {
  test("overspending a budget turns it red and raises an alert, live", async ({
    page,
    user,
    account,
    categories,
    userApi,
  }) => {
    // Create the budget through the UI.
    await page.goto(`${user.home}/budgets`);
    await page.getByRole("button", { name: "New budget" }).first().click();
    const dialog = page.getByRole("dialog", { name: "New budget" });
    await dialog.getByRole("button", { name: /Choose a category/ }).click();
    await page.getByPlaceholder("Search categories…").fill("Groceries");
    await page.getByRole("option", { name: /Groceries/ }).click();
    await dialog.getByLabel("Monthly amount").fill("100");
    await dialog.getByRole("button", { name: "Add budget" }).click();

    const budget = page.getByRole("button", { name: /^Edit Groceries/ });
    await expect(budget).toContainText("On track");
    await expect(page.getByRole("meter", { name: "Groceries budget" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );

    // Someone spends $120 on groceries (through the API, like another device would).
    await userApi.post<TransactionDto>(`/households/${user.householdId}/transactions`, {
      accountId: account.id,
      categoryId: categories.get("Groceries")!.id,
      amountMinor: -12_000,
      occurredOn: today(),
      description: "Weekly shop",
    });

    /*
     * No reload. The insert fires a database trigger → a job → the worker
     * evaluates budgets → a notification → Postgres NOTIFY → the SSE stream →
     * this page refetches. Every layer of the stack has to work for this to pass.
     */
    await expect(budget).toContainText("Over budget");
    await expect(page.getByRole("meter", { name: "Groceries budget" })).toHaveAttribute(
      "aria-valuenow",
      "120",
    );
    // The alert pops up as a toast…
    const toasts = page.getByRole("region", { name: /Notifications/ });
    await expect(toasts.getByText("Groceries is over budget")).toBeVisible();
    // …and waits, unread, in the bell.
    const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
    await bell.click();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /Groceries is over budget.*Unread/ }),
    ).toContainText("$120.00 of $100.00");
  });
});
