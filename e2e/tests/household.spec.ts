import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { PASSWORD, expect, test } from "../src/fixtures.js";

const row = (page: Page, description: string) =>
  page.getByRole("list", { name: "Transactions" }).getByRole("button", { name: description });

test.describe("sharing a household", () => {
  test("an invited partner joins, and both screens stay in sync without reloading", async ({
    page,
    user,
    account,
    browser,
  }) => {
    void account;
    const partnerEmail = `e2e-${randomUUID()}@example.test`;

    // ── The owner invites someone ────────────────────────────────────────────
    await page.goto(`${user.home}/household`);
    // The fixture signs up with timeZone "UTC"; the setting must show exactly that.
    await expect(page.getByLabel("Time zone")).toHaveValue("UTC");
    await page.getByRole("button", { name: "Invite someone" }).click();
    const invite = page.getByRole("dialog");
    await invite.getByLabel("Email").fill(partnerEmail);
    await invite.getByRole("radio", { name: /Editor/ }).click();
    await invite.getByRole("button", { name: "Send invitation" }).click();
    await expect(invite.getByText("Invitation sent")).toBeVisible();
    // The link is shown once, right now, so it can also be shared directly.
    const link = await invite.locator("code").innerText();
    await invite.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("main").getByText(partnerEmail)).toBeVisible(); // pending invitation

    // ── The partner, in a separate browser, follows the link and signs up ────
    const partnerContext = await browser.newContext();
    const partner = await partnerContext.newPage();
    await partner.goto(link);
    await expect(
      partner.getByText(`Join ${user.displayName.split(" ")[0]}'s Household`),
    ).toBeVisible();
    await partner.getByRole("link", { name: "Create an account to join" }).click();
    // The address is filled in from the invitation.
    await expect(partner.getByLabel("Email")).toHaveValue(partnerEmail);
    await partner.getByLabel("Your name").fill("Jamie Rivera");
    await partner.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await partner.getByRole("button", { name: "Create account" }).click();
    await partner.getByRole("button", { name: "Join household" }).click();
    await partner.waitForURL(new RegExp(user.home));

    // The owner's member list updates by itself.
    await expect(page.getByText("Jamie Rivera").first()).toBeVisible();

    // ── Live collaboration ───────────────────────────────────────────────────
    await page.goto(`${user.home}/transactions`);
    await partner.goto(`${user.home}/transactions`);
    // Presence: the owner can see the partner is here right now.
    await expect(page.getByText("Jamie Rivera is here")).toBeAttached();

    await partner.getByRole("button", { name: /New transaction/ }).click();
    const sheet = partner.getByRole("dialog");
    await sheet.getByLabel("Amount").fill("31.20");
    await sheet.getByLabel("Description").fill("Dinner for two");
    await sheet.getByRole("button", { name: "Add expense" }).click();

    // On the OWNER's screen, with no reload: the row, and who added it.
    await expect(row(page, "Dinner for two")).toBeVisible();
    await expect(page.getByText("Jamie added a transaction")).toBeVisible();

    await partnerContext.close();
    // The partner left: presence notices.
    await expect(page.getByText("Jamie Rivera is here")).not.toBeAttached({ timeout: 15_000 });
  });
});
