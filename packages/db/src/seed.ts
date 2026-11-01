import { v7 as uuidv7 } from "uuid";
import type { Database } from "./client.js";
import {
  accounts,
  categories,
  householdMembers,
  households,
  transactions,
  users,
  type NewTransaction,
} from "./schema.js";

/**
 * Demo data: one household, four accounts, a category tree and ~12 months of
 * realistic transactions (salary, rent, groceries, coffee, card payments…).
 *
 * It's DETERMINISTIC: a seeded pseudo-random generator means the same `seed` and
 * `today` always produce exactly the same data. Bugs found with seed data can be
 * reproduced by anyone, and tests can assert on it.
 */

/**
 * The demo user's password is "correct-horse-ledger". This is its Argon2id hash,
 * computed once — so seeding doesn't need the hashing library, and the plain-text
 * password appears only in documentation, never in the database.
 */
export const DEMO_PASSWORD = "correct-horse-ledger";
const DEMO_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$0qdhTNREf1YEFdt/mL2Dcg$7Uu0tv5TpLS8YYmOt+OpxxbiZ3Ay2hs3sAiuy53lFXA"; // gitleaks:allow (not a secret)

// ─── Tiny deterministic random toolkit ───────────────────────────────────────

/** mulberry32: a small, fast, seedable PRNG. NOT for security — only for fake data. */
function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    chance: (probability: number) => next() < probability,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    /** A price in cents between two dollar amounts, e.g. cents(3.5, 6.75). */
    cents: (minDollars: number, maxDollars: number) =>
      Math.round(minDollars * 100 + next() * (maxDollars - minDollars) * 100),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}

// ─── Date helpers (all on "YYYY-MM-DD" strings, in UTC, no time-zone surprises) ─

const toIso = (date: Date) => date.toISOString().slice(0, 10);
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
const isoDate = (year: number, month: number, day: number) =>
  toIso(new Date(Date.UTC(year, month, Math.min(day, daysInMonth(year, month)))));

// ─── Fixtures ────────────────────────────────────────────────────────────────

type CategorySpec = { name: string; kind: "income" | "expense"; icon: string; children?: string[] };

const categoryTree: CategorySpec[] = [
  { name: "Salary", kind: "income", icon: "briefcase" },
  { name: "Freelance", kind: "income", icon: "laptop" },
  { name: "Interest", kind: "income", icon: "piggy-bank" },
  { name: "Housing", kind: "expense", icon: "home", children: ["Rent", "Utilities", "Internet"] },
  {
    name: "Food",
    kind: "expense",
    icon: "utensils",
    children: ["Groceries", "Dining out", "Coffee"],
  },
  {
    name: "Transport",
    kind: "expense",
    icon: "car",
    children: ["Fuel", "Rideshare", "Public transit"],
  },
  { name: "Shopping", kind: "expense", icon: "shopping-bag" },
  { name: "Health", kind: "expense", icon: "heart-pulse" },
  { name: "Entertainment", kind: "expense", icon: "film", children: ["Streaming", "Events"] },
  { name: "Travel", kind: "expense", icon: "plane" },
];

const merchants = {
  Groceries: ["Whole Foods Market", "Trader Joe's", "Costco", "Safeway", "Farmers market"],
  "Dining out": ["Sushi Zen", "Nopa", "Tacolicious", "Burma Love", "Pizzeria Delfina"],
  Coffee: ["Blue Bottle Coffee", "Sightglass", "Philz Coffee", "Ritual Coffee"],
  Rideshare: ["Uber", "Lyft"],
  Fuel: ["Shell", "Chevron"],
  Shopping: ["Amazon", "Target", "Uniqlo", "IKEA", "Apple Store"],
  Health: ["CVS Pharmacy", "One Medical", "Dental care"],
  Events: ["Cinema", "Concert tickets", "Museum"],
  Travel: ["United Airlines", "Airbnb", "Marriott"],
} as const;

export interface SeedOptions {
  /** "YYYY-MM-DD" — data is generated for the 12 months up to and including this day. */
  today?: string;
  seed?: number;
}

export async function seedDemoData(
  db: Database,
  { today = toIso(new Date()), seed = 42 }: SeedOptions = {},
) {
  const random = createRandom(seed);

  // Everything in ONE database transaction: either all of it is inserted, or none.
  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: "demo@ledgerly.app",
        displayName: "Alex Demo",
        passwordHash: DEMO_PASSWORD_HASH,
      })
      .returning();
    const [household] = await tx
      .insert(households)
      .values({ name: "Alex's Household", baseCurrency: "USD" })
      .returning();
    if (!user || !household) throw new Error("Seeding failed to create the demo user");
    const householdId = household.id;

    await tx.insert(householdMembers).values({ householdId, userId: user.id, role: "owner" });

    const insertedAccounts = await tx
      .insert(accounts)
      .values([
        {
          householdId,
          name: "Everyday Checking",
          type: "checking",
          currency: "USD",
          openingBalanceMinor: 245_000,
        },
        {
          householdId,
          name: "High-Yield Savings",
          type: "savings",
          currency: "USD",
          openingBalanceMinor: 1_200_000,
        },
        {
          householdId,
          name: "Visa Signature",
          type: "credit_card",
          currency: "USD",
          openingBalanceMinor: 0,
        },
        { householdId, name: "Cash", type: "cash", currency: "USD", openingBalanceMinor: 12_000 },
      ])
      .returning();
    const account = Object.fromEntries(insertedAccounts.map((a) => [a.type, a.id])) as Record<
      "checking" | "savings" | "credit_card" | "cash",
      string
    >;

    // Parents first, then children (children need their parent's id).
    const categoryId: Record<string, string> = {};
    for (const [index, spec] of categoryTree.entries()) {
      const [parent] = await tx
        .insert(categories)
        .values({
          householdId,
          name: spec.name,
          kind: spec.kind,
          icon: spec.icon,
          sortOrder: index,
        })
        .returning();
      categoryId[spec.name] = parent!.id;
      for (const [childIndex, child] of (spec.children ?? []).entries()) {
        const [row] = await tx
          .insert(categories)
          .values({
            householdId,
            parentId: parent!.id,
            name: child,
            kind: spec.kind,
            sortOrder: childIndex,
          })
          .returning();
        categoryId[child] = row!.id;
      }
    }

    // ── Generate a year of everyday life ───────────────────────────────────
    const rows: NewTransaction[] = [];
    const add = (
      occurredOn: string,
      accountKey: keyof typeof account,
      category: string | null,
      description: string,
      amountMinor: number,
      transferId?: string,
    ) => {
      if (occurredOn > today) return; // never create future transactions
      rows.push({
        id: uuidv7(),
        householdId,
        accountId: account[accountKey],
        categoryId: category ? categoryId[category]! : null,
        amountMinor,
        occurredOn,
        description,
        transferId: transferId ?? null,
        createdBy: user.id,
      });
    };
    const transfer = (
      on: string,
      from: keyof typeof account,
      to: keyof typeof account,
      label: string,
      cents: number,
    ) => {
      const transferId = uuidv7();
      add(on, from, null, label, -cents, transferId);
      add(on, to, null, label, cents, transferId);
    };

    const end = new Date(`${today}T00:00:00Z`);
    for (let offset = 11; offset >= 0; offset--) {
      const year = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - offset, 1),
      ).getUTCFullYear();
      const month = new Date(
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - offset, 1),
      ).getUTCMonth();
      const day = (d: number) => isoDate(year, month, d);
      const randomDay = () => day(random.int(1, daysInMonth(year, month)));

      // Income
      add(day(1), "checking", "Salary", "Salary — Acme Inc.", 212_500);
      add(day(15), "checking", "Salary", "Salary — Acme Inc.", 212_500);
      if (random.chance(0.4))
        add(randomDay(), "checking", "Freelance", "Freelance invoice", random.cents(300, 1500));
      add(day(31), "savings", "Interest", "Interest payment", random.cents(38, 55));

      // Fixed costs
      add(day(1), "checking", "Rent", "Rent — Mission St apartment", -165_000);
      add(day(1), "checking", "Public transit", "Clipper monthly pass", -9_800);
      add(day(10), "checking", "Utilities", "PG&E electricity", -random.cents(70, 160));
      add(day(18), "credit_card", "Internet", "Sonic fiber internet", -5_999);
      add(day(5), "credit_card", "Streaming", "Netflix", -1_549);
      add(day(12), "credit_card", "Streaming", "Spotify", -1_199);
      transfer(day(2), "checking", "savings", "Monthly savings", 50_000);

      // Variable spending
      for (let d = random.int(1, 4); d <= daysInMonth(year, month); d += random.int(5, 8)) {
        add(
          day(d),
          "credit_card",
          "Groceries",
          random.pick(merchants.Groceries),
          -random.cents(45, 160),
        );
      }
      for (let i = 0; i < random.int(7, 12); i++) {
        const useCash = random.chance(0.25);
        add(
          randomDay(),
          useCash ? "cash" : "credit_card",
          "Coffee",
          random.pick(merchants.Coffee),
          -random.cents(3.5, 6.75),
        );
      }
      for (let i = 0; i < random.int(3, 7); i++)
        add(
          randomDay(),
          "credit_card",
          "Dining out",
          random.pick(merchants["Dining out"]),
          -random.cents(18, 85),
        );
      for (let i = 0; i < random.int(1, 4); i++)
        add(
          randomDay(),
          "credit_card",
          "Rideshare",
          random.pick(merchants.Rideshare),
          -random.cents(9, 32),
        );
      for (let i = 0; i < random.int(1, 2); i++)
        add(randomDay(), "credit_card", "Fuel", random.pick(merchants.Fuel), -random.cents(35, 65));
      for (let i = 0; i < random.int(1, 4); i++)
        add(
          randomDay(),
          "credit_card",
          "Shopping",
          random.pick(merchants.Shopping),
          -random.cents(15, 180),
        );
      if (random.chance(0.35))
        add(
          randomDay(),
          "credit_card",
          "Health",
          random.pick(merchants.Health),
          -random.cents(20, 140),
        );
      if (random.chance(0.45))
        add(
          randomDay(),
          "credit_card",
          "Events",
          random.pick(merchants.Events),
          -random.cents(25, 120),
        );
      if (random.chance(0.18))
        add(
          randomDay(),
          "credit_card",
          "Travel",
          random.pick(merchants.Travel),
          -random.cents(300, 1200),
        );
      if (random.chance(0.5))
        transfer(randomDay(), "checking", "cash", "ATM withdrawal", random.int(4, 10) * 2_000);
    }

    // Pay the credit card in full on the 25th of each month — a transfer, computed
    // from the card's actual running balance so the demo stays consistent.
    rows.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
    let cardBalance = 0;
    const withPayments: NewTransaction[] = [];
    let lastPaidMonth = "";
    for (const row of rows) {
      const monthKey = row.occurredOn.slice(0, 7);
      if (row.occurredOn.slice(8) >= "25" && monthKey !== lastPaidMonth && cardBalance < 0) {
        const transferId = uuidv7();
        const on = `${monthKey}-25`;
        const amount = -cardBalance;
        withPayments.push(
          {
            id: uuidv7(),
            householdId,
            accountId: account.checking,
            amountMinor: -amount,
            occurredOn: on,
            description: "Visa payment",
            transferId,
            createdBy: user.id,
          },
          {
            id: uuidv7(),
            householdId,
            accountId: account.credit_card,
            amountMinor: amount,
            occurredOn: on,
            description: "Visa payment",
            transferId,
            createdBy: user.id,
          },
        );
        cardBalance = 0;
        lastPaidMonth = monthKey;
      }
      if (row.accountId === account.credit_card) cardBalance += row.amountMinor;
      withPayments.push(row);
    }

    // Insert in batches: one huge INSERT can hit Postgres' 65,535-parameter limit.
    for (let i = 0; i < withPayments.length; i += 500) {
      await tx.insert(transactions).values(withPayments.slice(i, i + 500));
    }

    return { userId: user.id, householdId, transactionCount: withPayments.length };
  });
}
