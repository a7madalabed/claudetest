import { randomUUID } from "node:crypto";
import type { TransactionDto } from "@ledgerly/shared";
import { Secret, TOTP } from "otpauth";
import { PASSWORD, expect, signIn, test, today, watchCsp } from "../src/fixtures.js";
import { linkIn, waitForEmail } from "../src/mail.js";

/*
 * The account journeys that had no browser test before Stage 15 — each one
 * through the real UI and, where email is involved, the real email (Mailpit).
 */

const totp = (secret: string, timestamp = Date.now()) =>
  new TOTP({
    secret: Secret.fromBase32(secret),
    digits: 6,
    period: 30,
    algorithm: "SHA1",
  }).generate({ timestamp });

test.describe("account", () => {
  test("forgot password: the emailed link sets a new one, and old sessions end cleanly", async ({
    page,
    user,
    browser,
  }) => {
    const NEW_PASSWORD = "a-fresh-start-passphrase-9";
    // Someone who forgot their password, on another device.
    const visitor = await (await browser.newContext()).newPage();
    await visitor.goto("/login");
    await visitor.getByRole("link", { name: "Forgot password?" }).click();
    // Both pages have an "Email" field: wait until we're really on the new one
    // (typing into the old one was a 1-in-40 flake found by --repeat-each).
    await expect(visitor.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
    await visitor.getByLabel("Email").fill(user.email);
    await visitor.getByRole("button", { name: "Send reset link" }).click();
    await expect(visitor.getByRole("status")).toContainText("we've sent it a link");

    const email = await waitForEmail(user.email, /Reset your Ledgerly password/);
    await visitor.goto(linkIn(email, "/reset-password"));
    await visitor.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await visitor.getByLabel("Confirm new password").fill(NEW_PASSWORD);
    await visitor.getByRole("button", { name: "Set new password" }).click();
    await expect(visitor.getByRole("status")).toContainText("every device was signed out");

    // The new password works…
    await visitor.getByRole("link", { name: "Sign in" }).click();
    await signIn(visitor, user.email, NEW_PASSWORD);

    // …and the first device, still holding its old cookie, lands on the sign-in
    // page. (Before Stage 15 a stale cookie bounced between /app and /login forever.)
    await page.goto(user.home);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    // The owner is told, in case it wasn't them.
    await waitForEmail(user.email, /Your Ledgerly password was changed/);
  });

  test("a new account confirms its email from the link it was sent", async ({ page }) => {
    const email = `e2e-${randomUUID()}@example.test`;
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Robin Park");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/app\/[0-9a-f-]{36}/);

    const banner = page.getByRole("status").filter({ hasText: "Confirm your email" });
    await expect(banner).toContainText(email);

    const message = await waitForEmail(email, /Confirm your email for Ledgerly/);
    await page.goto(linkIn(message, "/verify-email"));
    await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
    await page.getByRole("link", { name: "Open Ledgerly" }).click();
    await page.waitForURL(/\/app\/[0-9a-f-]{36}/);
    await expect(banner).toHaveCount(0);
  });

  test("two-factor: turn it on, then sign in with a code — or a recovery code", async ({
    page,
    user,
  }) => {
    await page.goto("/app/settings/security");
    await page.getByRole("button", { name: "Set up two-factor" }).click();
    await page.getByText("Can't scan? Enter the key manually").click();
    const secret = (await page.locator("details code").innerText()).trim();
    await page.getByLabel("6-digit code from your authenticator app").fill(totp(secret));

    const codeItems = page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem");
    await expect(codeItems).toHaveCount(10);
    const codes = await codeItems.allInnerTexts();
    await page.getByRole("button", { name: "I've saved them" }).click();

    const signInWithSecondFactor = async (enter: () => Promise<void>) => {
      await page.context().clearCookies();
      await page.goto("/login");
      await page.getByLabel("Email").fill(user.email);
      await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await page.getByRole("button", { name: "Sign in" }).click();
      await page.waitForURL(/\/login\/verify/);
      await enter();
      await page.waitForURL(/\/app\/[0-9a-f-]{36}/);
    };

    // The code from the NEXT 30-second window: the one just used to switch 2FA
    // on would be refused as a replay, exactly as it should be.
    await signInWithSecondFactor(async () => {
      await page
        .getByLabel("6-digit code from your authenticator app")
        .fill(totp(secret, Date.now() + 30_000));
    });
    await signInWithSecondFactor(async () => {
      await page.getByRole("button", { name: "Use a recovery code instead" }).click();
      await page.getByLabel("Recovery code").fill(codes[0]!);
      await page.getByRole("button", { name: "Verify" }).click();
    });
  });

  test("your data: download it, then delete the account for good", async ({
    page,
    user,
    account,
    userApi,
  }) => {
    await userApi.post<TransactionDto>(`/households/${user.householdId}/transactions`, {
      accountId: account.id,
      amountMinor: -2_450,
      occurredOn: today(),
      description: "Farewell lunch",
    });
    await page.goto("/app/settings/security");

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download my data" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^ledgerly-export-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(
      await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString()),
    );
    expect(data.user.email).toBe(user.email);
    expect(data.households[0].transactions).toEqual([
      expect.objectContaining({ description: "Farewell lunch", amountMinor: -2_450 }),
    ]);

    await page.getByRole("button", { name: "Delete my account" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete your account?" });
    await dialog.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await dialog.getByRole("button", { name: "Delete forever" }).click();
    await page.waitForURL(/\/login\?deleted=1/);
    await expect(page.getByRole("status")).toContainText("Your account has been deleted");
    await waitForEmail(user.email, /Your Ledgerly account was deleted/);

    // Gone: the password no longer signs anyone in.
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /./ })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("the Content Security Policy blocks injected scripts — and the guard notices", async ({
    browser,
  }) => {
    // A context of our own, so the automatic guard doesn't fail THIS test.
    const context = await browser.newContext();
    const violations = await watchCsp(context);
    /*
     * Simulate stored cross-site scripting: an attacker's <script> arrives
     * INSIDE the page's HTML, with the real response headers (CSP included).
     * (Injecting through page.evaluate wouldn't prove anything: scripts added
     * via the DevTools protocol are exempt from CSP.)
     */
    await context.route("**/login", async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(
        "</body>",
        "<script>window.__pwned = true</script></body>",
      );
      await route.fulfill({ response, body: html });
    });
    const visitor = await context.newPage();
    const response = await visitor.goto("/login");
    const csp = response!.headers()["content-security-policy"]!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(response!.headers()["x-frame-options"]).toBe("DENY");

    // The page still works (Next's own, nonced scripts run)…
    await expect(visitor.getByRole("button", { name: "Sign in" })).toBeEnabled();
    // …but the injected script did not run, and the guard saw it being blocked.
    expect(await visitor.evaluate("window.__pwned")).toBeUndefined();
    await expect.poll(() => violations.join("\n")).toContain("script-src");
    await context.close();
  });
});
