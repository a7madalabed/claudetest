import { expect, test } from "../src/fixtures.js";

/*
 * Stage 17: categories can be managed in the app. Before, a household was
 * stuck with whatever categories it started with, unless someone used the API.
 */
test.describe("categories", () => {
  test("add a subcategory, rename it, archive it and bring it back", async ({ page, user }) => {
    await page.goto(`${user.home}/categories`);
    const spending = page.getByRole("list", { name: "Spending categories" });
    await expect(spending.getByText("Groceries")).toBeVisible(); // the starter set

    // A subcategory inside "Food".
    await page.getByRole("button", { name: "New category" }).click();
    let dialog = page.getByRole("dialog", { name: "New category" });
    await dialog.getByLabel("Name").fill("Coffee");
    await dialog.getByRole("combobox", { name: "Inside" }).click();
    await page.getByRole("option", { name: "Food" }).click();
    await dialog.getByRole("button", { name: "Add category" }).click();
    await expect(page.getByRole("list", { name: "Inside Food" }).getByText("Coffee")).toBeVisible();

    // The same name twice at one level is refused, next to the field.
    await page.getByRole("button", { name: "New category" }).click();
    dialog = page.getByRole("dialog", { name: "New category" });
    await dialog.getByLabel("Name").fill("Transport");
    await dialog.getByRole("button", { name: "Add category" }).click();
    await expect(dialog.getByText(/already exists at this level/)).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // Rename.
    await page.getByRole("button", { name: "Edit Coffee" }).click();
    dialog = page.getByRole("dialog", { name: "Edit category" });
    await dialog.getByLabel("Name").fill("Coffee & tea");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(spending.getByText("Coffee & tea")).toBeVisible();

    // Archive, then bring back.
    await page.getByRole("button", { name: "Edit Coffee & tea" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive" }).click();
    const row = spending.getByRole("listitem").filter({ hasText: "Coffee & tea" });
    await expect(row.getByText("Archived")).toBeVisible();
    await page.getByRole("button", { name: "Edit Coffee & tea" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Unarchive" }).click();
    await expect(row.getByText("Archived")).toHaveCount(0);
  });
});
