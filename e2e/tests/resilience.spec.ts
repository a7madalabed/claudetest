import { expect, test } from "../src/fixtures.js";

/*
 * Stage 16: when the API fails, every page must SAY so and offer a way out.
 * Before, a failed request left a skeleton spinning forever, or an empty page
 * that looked like "you have no goals" — a wrong answer, in a money app.
 *
 * Each case breaks the request a page depends on (a 500, as from a bad
 * deploy or a database blip), checks the page says it couldn't load, then
 * lets the API recover and checks that "Try again" really does.
 */
const pages: Array<{ name: string; path: string; failing: RegExp }> = [
  { name: "accounts", path: "/accounts", failing: /\/accounts(\?|$)/ },
  { name: "goals", path: "/goals", failing: /\/goals(\?|$)/ },
  { name: "budgets", path: "/budgets", failing: /\/budgets\?/ },
  { name: "transactions", path: "/transactions", failing: /\/transactions\?/ },
  { name: "imports", path: "/imports", failing: /\/imports(\?|$)/ },
  { name: "household", path: "/household", failing: /\/members(\?|$)/ },
  { name: "dashboard", path: "", failing: /\/reports\/cashflow\?/ },
];

for (const { name, path, failing } of pages) {
  test(`${name}: a failed load says so, and "Try again" recovers`, async ({
    page,
    user,
    account,
  }) => {
    void account; // some data to show once it recovers
    let broken = true;
    await page.route(
      (url) => url.pathname.startsWith("/api/") && failing.test(url.pathname + url.search),
      (route) =>
        broken
          ? route.fulfill({
              status: 500,
              contentType: "application/json",
              body: JSON.stringify({ status: 500, code: "internal_error", title: "Internal error" }),
            })
          : route.continue(),
    );

    await page.goto(`${user.home}${path}`);
    // Queries retry twice with backoff before giving up, hence the longer wait.
    const alert = page.getByRole("alert").filter({ hasText: "Couldn't load this" }).first();
    await expect(alert).toBeVisible({ timeout: 15_000 });

    broken = false;
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't load this" })).toHaveCount(
      0,
    );
  });
}
