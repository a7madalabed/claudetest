import { expect, test } from "../src/fixtures.js";

/*
 * The public front door (Stage 19). It used to be the learning project's status
 * page: a stage counter, a roadmap of build stages, a "shared code check" and the
 * live API status with the build version, shown to anyone.
 */
test.describe("the home page", () => {
  test("says what Ledgerly is and how to start, in a visitor's words", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Ledgerly" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/signup",
    );
    await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Terms", exact: true })).toBeVisible();
  });

  test("shows nothing about how it was built, and no server details", async ({ page }) => {
    await page.goto("/");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const leak of ["stage", "roadmap", "shared code check", "stages complete"]) {
      expect(text, leak).not.toContain(leak);
    }
    // The old page printed the API's build version ("v<commit>") and its uptime.
    expect(text).not.toMatch(/\bv[0-9a-f]{7,}\b|\bv\d+\.\d+\.\d+|\bup \d/);
  });
});
