import { expect, test } from "../src/fixtures.js";

test.describe("pages that aren't for the public", () => {
  test("the design-system style guide is not served in production", async ({ page }) => {
    // This suite runs the production build, exactly like the container image.
    const response = await page.goto("/design");
    expect(response?.status()).toBe(404);
  });

  test("the home page doesn't link to it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Design system" })).toHaveCount(0);
  });
});
