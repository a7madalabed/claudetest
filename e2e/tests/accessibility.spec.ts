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

    test("home, sign-in, sign-up, privacy and terms pages", async ({ page, axe }) => {
      for (const path of ["/", "/login", "/signup", "/privacy", "/terms"]) {
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

    /*
     * The first sweep always starts from a household with an account, a transaction
     * and a budget, which hides every "nothing here yet" state, and it never has
     * income, so the savings stamp was never checked either. Stage 18's new colours
     * made the "Create one" link (no budgets yet) fail contrast, and nothing noticed.
     */
    test("a brand-new household, before anything is added", async ({ page, user, axe }) => {
      // Collect every page's problems, then assert once: one bad page mustn't hide the rest.
      const problems: string[] = [];
      for (const path of APP_PAGES.map((p) => `${user.home}${p}`)) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle");
        const pageName = path.replace(user.home, "") || "/ (dashboard)";
        problems.push(
          ...describe((await axe().analyze()).violations).map((v) => `${pageName}: ${v}`),
        );
      }
      expect(problems).toEqual([]);
    });

    test("the dashboard with income and no budgets (savings stamp, 'Create one')", async ({
      page,
      user,
      account,
      userApi,
      axe,
    }) => {
      for (const [amountMinor, description] of [
        [200_000, "Salary"],
        [-190_000, "Rent"],
      ] as const) {
        await userApi.post(`/households/${user.householdId}/transactions`, {
          accountId: account.id,
          amountMinor,
          occurredOn: today(),
          description,
        });
      }
      await page.goto(user.home);
      await expect(page.getByText("Below target")).toBeVisible(); // the stamp is on screen
      await expect(page.getByRole("link", { name: "Create one" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(describe((await axe().analyze()).violations), "dashboard").toEqual([]);
    });
  });
}
