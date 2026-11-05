import { categories, type DbExecutor } from "@ledgerly/db";

/**
 * The categories every new household starts with, so the first transaction
 * can be categorised straight away. Used by sign-up AND by "New household"
 * (which used to start with none, and had no screen to add any: Stage 16).
 */
const STARTER_CATEGORIES: Array<{
  name: string;
  kind: "income" | "expense";
  icon: string;
  children?: string[];
}> = [
  { name: "Salary", kind: "income", icon: "briefcase" },
  { name: "Other income", kind: "income", icon: "sparkles" },
  { name: "Housing", kind: "expense", icon: "home", children: ["Rent", "Utilities"] },
  { name: "Food", kind: "expense", icon: "utensils", children: ["Groceries", "Dining out"] },
  { name: "Transport", kind: "expense", icon: "car" },
  { name: "Shopping", kind: "expense", icon: "shopping-bag" },
  { name: "Health", kind: "expense", icon: "heart-pulse" },
  { name: "Entertainment", kind: "expense", icon: "film" },
];

/** Run it in the transaction that creates the household. */
export async function createStarterCategories(tx: DbExecutor, householdId: string) {
  for (const [index, spec] of STARTER_CATEGORIES.entries()) {
    const [parent] = await tx
      .insert(categories)
      .values({ householdId, name: spec.name, kind: spec.kind, icon: spec.icon, sortOrder: index })
      .returning({ id: categories.id });
    if (spec.children?.length) {
      await tx.insert(categories).values(
        spec.children.map((name, childIndex) => ({
          householdId,
          parentId: parent!.id,
          name,
          kind: spec.kind,
          sortOrder: childIndex,
        })),
      );
    }
  }
}
