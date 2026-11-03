import type { Page } from "@playwright/test";
import { expect, test, today } from "../src/fixtures.js";

const row = (page: Page, description: string) =>
  page.getByRole("list", { name: "Transactions" }).getByRole("button", { name: description });

test.describe("CSV import", () => {
  test("a bank export is mapped, imported in the background, and can be undone", async ({
    page,
    user,
    account,
  }) => {
    const day = today();
    // A small export the way a bank writes it — including a junk "pending" line.
    const csv = [
      "Date,Description,Amount",
      `${day},Farmers market,-23.50`,
      `${day},Paycheck,"1,850.00"`,
      `${day},Bookshop,-12.99`,
      "Pending,Card authorisation,-5.00",
    ].join("\n");

    await page.goto(`${user.home}/imports`);
    await page.getByRole("combobox", { name: "Import into" }).click();
    await page.getByRole("option", { name: account.name }).click();
    await page.locator("input[type=file]").setInputFiles({
      name: "statement.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

    // The guessed mapping is previewed before anything is written.
    await expect(page.getByText("Match the columns")).toBeVisible();
    await page.getByRole("button", { name: /^Import [\d,]+ rows$/ }).click();

    // The worker does the import; the page follows its progress.
    await expect(page.getByText("Import complete")).toBeVisible({ timeout: 20_000 });
    const summary = page.locator("dl").first();
    // <dt>label</dt><dd>count</dd> pairs, read as text: "Imported 3 … Couldn't read 1".
    await expect(summary).toHaveText(/Imported\s*3\b/);
    await expect(summary).toHaveText(/Already imported\s*0\b/);
    await expect(summary).toHaveText(/Couldn.t read\s*1\b/); // the pending line

    await page.goto(`${user.home}/transactions`);
    for (const description of ["Farmers market", "Paycheck", "Bookshop"]) {
      await expect(row(page, description)).toBeVisible();
    }
    await expect(row(page, "Paycheck")).toContainText("$1,850.00");
    await expect(row(page, "Card authorisation")).toHaveCount(0);

    // Undo removes exactly what the import added.
    await page.goto(`${user.home}/imports`);
    await page.getByRole("button", { name: /Undo import/ }).click();
    await page.getByRole("button", { name: "Click again to undo" }).click();
    await expect(page.getByText(/Removed 3/)).toBeVisible();
    await page.goto(`${user.home}/transactions`);
    await expect(row(page, "Farmers market")).toHaveCount(0);
  });
});
