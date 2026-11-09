import { expect, test } from "../src/fixtures.js";

test.describe("privacy and terms", () => {
  test("are public, and a new visitor reaches them from the sign-up page", async ({ page }) => {
    await page.goto("/signup");
    await page.getByRole("link", { name: "terms" }).click();
    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();

    await page.getByRole("link", { name: "Privacy", exact: true }).click(); // the footer of the page
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
    // What the policy promises is what the app offers.
    await expect(page.getByText("Download my data")).toBeVisible();
    await expect(page.getByText("no analytics")).toBeVisible();
  });

  test("show who to write to, from the deployment's settings", async ({ page }) => {
    await page.goto("/privacy");
    await expect(page.getByText("Ledgerly is run by Test Operator.")).toBeVisible();
    await expect(page.getByRole("link", { name: "privacy@ledgerly.test" })).toHaveAttribute(
      "href",
      "mailto:privacy@ledgerly.test",
    );
  });
});
