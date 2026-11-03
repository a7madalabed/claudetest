import { randomUUID } from "node:crypto";
import { PASSWORD, expect, signIn, signUp, test } from "../src/fixtures.js";

test.describe("signing up and in", () => {
  test("a visitor creates an account, signs out, and signs back in", async ({ page }) => {
    const email = `e2e-${randomUUID()}@example.test`;
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Robin Park");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();

    // A new account lands in its own, new household.
    await page.waitForURL(/\/app\/[0-9a-f-]{36}/);
    await expect(page.getByText("Robin Park").first()).toBeVisible();

    await page.getByRole("button", { name: /Robin Park/ }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);

    // Signed out means signed out: the app sends us back to the login page.
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    await signIn(page, email);
    await expect(page.getByText("Robin Park").first()).toBeVisible();
  });

  test("a deep link survives the trip through the login page", async ({ page }) => {
    const user = await signUp(page.request);
    await page.context().clearCookies();

    await page.goto(`${user.home}/budgets`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(new RegExp(`${user.home}/budgets`));
  });

  test("a wrong password is refused without revealing whether the account exists", async ({
    page,
  }) => {
    const user = await signUp(page.request);
    await page.context().clearCookies();

    const attempt = async (email: string) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill("not-the-right-password");
      await page.getByRole("button", { name: "Sign in" }).click();
      const alert = page.getByRole("alert").filter({ hasText: /./ });
      await expect(alert).toBeVisible();
      return alert.innerText();
    };
    // Same message for a real account and a made-up one (no account enumeration).
    expect(await attempt(user.email)).toBe(await attempt(`nobody-${randomUUID()}@example.test`));
    await expect(page).toHaveURL(/\/login/);
  });
});
