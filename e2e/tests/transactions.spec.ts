import type { Page } from "@playwright/test";
import type { TransactionDto } from "@ledgerly/shared";
import { expect, test, today } from "../src/fixtures.js";

/** A row of the transaction list, found the way a screen reader user would. */
const row = (page: Page, description: string) =>
  page.getByRole("list", { name: "Transactions" }).getByRole("button", { name: description });

test.describe("transactions", () => {
  test("adding an expense shows it at once, and it's still there after a reload", async ({
    page,
    user,
    account,
  }) => {
    void account; // the household needs an account to add to
    await page.goto(`${user.home}/transactions`);
    await page.getByRole("button", { name: /New transaction/ }).click();

    const sheet = page.getByRole("dialog");
    await sheet.getByLabel("Amount").fill("18.40");
    await sheet.getByLabel("Description").fill("Bike repair");
    await sheet.getByRole("button", { name: "Add expense" }).click();

    const added = row(page, "Bike repair");
    await expect(added).toBeVisible();
    await expect(added).toContainText("−$18.40"); // a real minus sign, not a hyphen
    await expect(page.getByText("Expense added")).toBeVisible();

    await page.reload();
    await expect(added).toBeVisible();
  });

  test("the account is filled in even when the sheet opens before accounts have loaded", async ({
    page,
    user,
    account,
  }) => {
    /*
     * This began as a FLAKY test: about one run in ten, the sheet opened before
     * the accounts request returned and the Account field stayed empty. Slowing
     * that one response down on purpose turns "sometimes" into "every time".
     */
    await page.route("**/api/v1/households/*/accounts*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.goto(`${user.home}/transactions`);
    await page.getByRole("button", { name: /New transaction/ }).click();
    await expect(page.getByRole("dialog").getByRole("combobox", { name: "Account" })).toHaveText(
      account.name,
    );
  });

  test("search narrows the list, and the search lives in the URL", async ({
    page,
    user,
    account,
    userApi,
  }) => {
    for (const description of ["Corner Café", "Hardware store", "Café Luna"]) {
      await userApi.post<TransactionDto>(`/households/${user.householdId}/transactions`, {
        accountId: account.id,
        amountMinor: -1_250,
        occurredOn: today(),
        description,
      });
    }
    await page.goto(`${user.home}/transactions?q=caf`);
    await expect(page.getByRole("searchbox", { name: "Search transactions" })).toHaveValue("caf");
    await expect(row(page, "Corner Café")).toBeVisible();
    await expect(row(page, "Café Luna")).toBeVisible();
    await expect(row(page, "Hardware store")).toHaveCount(0);

    // Clearing the search brings everything back.
    await page.getByRole("searchbox", { name: "Search transactions" }).clear();
    await expect(row(page, "Hardware store")).toBeVisible();
  });

  test("deleting a transaction can be undone", async ({ page, user, account, userApi }) => {
    await userApi.post<TransactionDto>(`/households/${user.householdId}/transactions`, {
      accountId: account.id,
      amountMinor: -4_200,
      occurredOn: today(),
      description: "Concert tickets",
    });
    await page.goto(`${user.home}/transactions`);
    const tickets = row(page, "Concert tickets");
    await tickets.click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(tickets).toHaveCount(0);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(tickets).toBeVisible();
    await page.reload(); // the undo really reached the server
    await expect(tickets).toBeVisible();
  });
});
