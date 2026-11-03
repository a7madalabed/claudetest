import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import type { AccountDto, CategoryDto, MeDto } from "@ledgerly/shared";

/*
 * Test fixtures: the "given…" of every test, set up through the API (fast and
 * reliable), so the browser only does the part a test is actually about.
 *
 * Each test gets its OWN brand-new user and household. Nothing is shared, so
 * tests can run in parallel, in any order, and a failure can't cascade.
 */

export const PASSWORD = "e2e-correct-horse-battery";

export interface TestUser {
  email: string;
  password: string;
  displayName: string;
  householdId: string;
  /** "/app/<householdId>" — prefix for every page in the household. */
  home: string;
}

/** A thin JSON client for the API, through the web app's /api proxy (like the browser). */
export function api(request: APIRequestContext) {
  const call = async <T>(method: string, path: string, data?: unknown): Promise<T> => {
    const response = await request.fetch(`/api/v1${path}`, { method, data });
    if (!response.ok()) {
      throw new Error(`${method} ${path} → ${response.status()}: ${await response.text()}`);
    }
    return (response.status() === 204 ? undefined : await response.json()) as T;
  };
  return {
    get: <T>(path: string) => call<T>("GET", path),
    post: <T>(path: string, data?: unknown) => call<T>("POST", path, data ?? {}),
  };
}

/** Sign up through the API. The request context's cookie jar then holds the session. */
export async function signUp(
  request: APIRequestContext,
  displayName = "Alex Morgan",
): Promise<TestUser> {
  const email = `e2e-${randomUUID()}@example.test`;
  const me = await api(request).post<MeDto>("/auth/signup", {
    email,
    password: PASSWORD,
    displayName,
    timeZone: "UTC",
  });
  const householdId = me.households[0]!.id;
  return { email, password: PASSWORD, displayName, householdId, home: `/app/${householdId}` };
}

export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\/[0-9a-f-]{36}/);
}

/** Today in UTC (the suite's browser and server time zone), "YYYY-MM-DD". */
export const today = () => new Date().toISOString().slice(0, 10);

interface Fixtures {
  /** A fresh user, signed in in `page`'s browser context. */
  user: TestUser;
  /** A checking account in the user's household. */
  account: AccountDto;
  /** The household's categories, by name. */
  categories: Map<string, CategoryDto>;
  /** API client acting as `user`. */
  userApi: ReturnType<typeof api>;
  /** Accessibility scan of the current page (axe-core, WCAG 2.1 A/AA). */
  axe: () => AxeBuilder;
}

export const test = base.extend<Fixtures>({
  // page.request shares the page's cookies: signing up here signs the browser in.
  user: async ({ page }, use) => use(await signUp(page.request)),
  userApi: async ({ page, user }, use) => {
    void user; // depend on `user` so the session exists first
    await use(api(page.request));
  },
  account: async ({ user, userApi }, use) => {
    const account = await userApi.post<AccountDto>(`/households/${user.householdId}/accounts`, {
      name: "Everyday Checking",
      type: "checking",
      currency: "USD",
      openingBalanceMinor: 250_000,
    });
    await use(account);
  },
  categories: async ({ user, userApi }, use) => {
    const { data } = await userApi.get<{ data: CategoryDto[] }>(
      `/households/${user.householdId}/categories`,
    );
    await use(new Map(data.map((c) => [c.name, c])));
  },
  axe: async ({ page }, use) => {
    await use(() =>
      new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]),
    );
  },
});

export { expect };
