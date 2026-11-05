import type AxeBuilder from "@axe-core/playwright";
import type { TransactionDto } from "@ledgerly/shared";
import { expect, test, today } from "../src/fixtures.js";

/*
 * Automated accessibility checks with axe-core against WCAG 2.1 A and AA.
 *
 * Automated tools catch roughly a third to a half of real accessibility
 * problems (missing labels, contrast, invalid ARIA, landmark structure…). They
 * are a floor, not a certificate: keyboard flows and screen-reader wording are
 * covered by the journeys, which find everything by role and accessible name.
 */

type Violations = Awaited<ReturnType<AxeBuilder["analyze"]>>["violations"];

/** One readable line per problem, instead of a wall of JSON. */
const describe = (violations: Violations) =>
  violations.flatMap((v) =>
    v.nodes.map((n) => `[${v.impact}] ${v.id}: ${v.help} → ${n.target.join(" ")}`),
  );

const APP_PAGES = [
  "",
  "/transactions",
  "/budgets",
  "/goals",
  "/accounts",
  "/imports",
  "/household",
  "/categories",
];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("sign-in and sign-up pages", async ({ page, axe }) => {
      for (const path of ["/login", "/signup"]) {
        await page.goto(path);
        await expect(page.getByRole("main")).toBeVisible();
        expect(describe((await axe().analyze()).violations), path).toEqual([]);
      }
    });

    test("every page of the app, with data on it", async ({
      page,
      user,
      account,
      categories,
      userApi,
      axe,
    }) => {
      // Real content, so the scan sees lists, charts and badges — not just empty states.
      await userApi.post<TransactionDto>(`/households/${user.householdId}/transactions`, {
        accountId: account.id,
        categoryId: categories.get("Groceries")!.id,
        amountMinor: -8_420,
        occurredOn: today(),
        description: "Weekly shop",
      });
      await userApi.post(`/households/${user.householdId}/budgets`, {
        categoryId: categories.get("Groceries")!.id,
        amountMinor: 10_000,
        startMonth: today().slice(0, 7),
      });

      for (const path of [...APP_PAGES.map((p) => `${user.home}${p}`), "/app/settings/security"]) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle");
        const pageName = path.replace(user.home, "") || "/ (dashboard)";
        expect(describe((await axe().analyze()).violations), pageName).toEqual([]);
      }
    });
  });
}
