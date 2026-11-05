import { randomUUID } from "node:crypto";
import { PASSWORD, expect, test } from "../src/fixtures.js";

/*
 * Stage 16: the journey a REAL new user takes, with nothing set up behind the
 * scenes. Every other test gets an account from the API (src/fixtures.ts),
 * which is how the app shipped with no way to create one in the UI: a brand-new
 * user could sign up, and then do nothing at all.
 */
test.describe("first run", () => {
  test("a new user adds their first account and records their first expense", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Sam First");
    await page.getByLabel("Email").fill(`e2e-${randomUUID()}@example.test`);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/app\/[0-9a-f-]{36}/);

    // The dashboard says where to start, instead of a page of zeros.
    await expect(page.getByRole("heading", { name: "Welcome, Sam" })).toBeVisible();
    await expect(page.getByText("Start by adding an account")).toBeVisible();

    // Recording a transaction with no account explains what's missing.
    await page.getByRole("link", { name: "Transactions" }).click();
    await page.getByRole("button", { name: /New transaction/ }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Add your first account")).toBeVisible();
    await sheet.getByRole("link", { name: "Add an account" }).click();

    // …which opens the new-account dialog on the Accounts page.
    await expect(page).toHaveURL(/\/accounts/);
    const dialog = page.getByRole("dialog", { name: "Add an account" });
    await dialog.getByLabel("Name").fill("Everyday checking");
    await dialog.getByLabel("Balance today").fill("1250");
    await dialog.getByRole("button", { name: "Add account" }).click();
    await expect(page.getByText("Account “Everyday checking” added")).toBeVisible();
    const card = page.getByRole("main").getByRole("listitem").filter({ hasText: "Everyday checking" });
    await expect(card).toContainText("$1,250.00");

    // And now the first expense goes in, and the balance follows.
    await page.getByRole("link", { name: "Transactions" }).click();
    await page.getByRole("button", { name: /New transaction/ }).click();
    await sheet.getByLabel("Amount").fill("42.50");
    await sheet.getByLabel("Description").fill("First groceries");
    await sheet.getByRole("button", { name: "Add expense" }).click();
    await expect(
      page.getByRole("list", { name: "Transactions" }).getByRole("button", {
        name: "First groceries",
      }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Accounts" }).click();
    await expect(card).toContainText("$1,207.50");
  });
});
