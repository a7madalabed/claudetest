import { and, asc, categories, eq, isPgError, type Category, type DbExecutor } from "@ledgerly/db";
import type { CategoryDto, CreateCategoryInput, UpdateCategoryInput } from "@ledgerly/shared";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";

function toDto(row: Category): CategoryDto {
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    kind: row.kind,
    icon: row.icon,
    sortOrder: row.sortOrder,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const nameTaken = (name: string) =>
  conflict("category_name_taken", `A category named "${name}" already exists at this level.`);

/** Flat list; clients build the tree from parentId (simple, cacheable, easy to diff). */
export async function listCategories(db: DbExecutor, householdId: string) {
  const rows = await db
    .select()
    .from(categories)
    .where(eq(categories.householdId, householdId))
    .orderBy(asc(categories.kind), asc(categories.sortOrder), asc(categories.name));
  return rows.map(toDto);
}

export async function getCategory(db: DbExecutor, householdId: string, categoryId: string) {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)));
  if (!row) throw notFound("Category");
  return row;
}

export async function createCategory(
  db: DbExecutor,
  householdId: string,
  input: CreateCategoryInput,
) {
  if (input.parentId) {
    // Business rules the database can't easily express:
    const parent = await getCategory(db, householdId, input.parentId).catch(() => {
      throw unprocessable("parent_not_found", "parentId", "Parent category not found.");
    });
    if (parent.parentId !== null) {
      throw unprocessable(
        "category_too_deep",
        "parentId",
        "Categories can only be nested one level deep.",
      );
    }
    if (parent.kind !== input.kind) {
      throw unprocessable(
        "category_kind_mismatch",
        "kind",
        `A subcategory must have the same kind as its parent (${parent.kind}).`,
      );
    }
  }
  try {
    const [created] = await db
      .insert(categories)
      .values({ householdId, ...input })
      .returning();
    return toDto(created!);
  } catch (error) {
    if (isPgError(error, "uniqueViolation", "categories_household_parent_name_key"))
      throw nameTaken(input.name);
    throw error;
  }
}

export async function updateCategory(
  db: DbExecutor,
  householdId: string,
  categoryId: string,
  input: UpdateCategoryInput,
) {
  const { archived, ...fields } = input;
  try {
    const [updated] = await db
      .update(categories)
      .set({
        ...fields,
        ...(archived !== undefined && { archivedAt: archived ? new Date() : null }),
      })
      .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)))
      .returning();
    if (!updated) throw notFound("Category");
    return toDto(updated);
  } catch (error) {
    if (isPgError(error, "uniqueViolation", "categories_household_parent_name_key"))
      throw nameTaken(input.name ?? "");
    throw error;
  }
}

export async function deleteCategory(db: DbExecutor, householdId: string, categoryId: string) {
  try {
    const deleted = await db
      .delete(categories)
      .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)))
      .returning({ id: categories.id });
    if (deleted.length === 0) throw notFound("Category");
  } catch (error) {
    if (isPgError(error, "foreignKeyViolation")) {
      throw conflict(
        "category_in_use",
        "This category has transactions or subcategories. Archive it instead.",
      );
    }
    throw error;
  }
}
