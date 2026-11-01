import {
  accounts,
  and,
  categories,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  or,
  sql,
  transactions,
  type DbExecutor,
  type Transaction,
} from "@ledgerly/db";
import type {
  CreateTransactionInput,
  CreateTransferInput,
  TransactionDto,
  TransactionListQuery,
  TransactionPage,
  UpdateTransactionInput,
} from "@ledgerly/shared";
import { v7 as uuidv7 } from "uuid";
import { decodeCursor, encodeCursor } from "../../lib/cursor.js";
import { notFound, unprocessable } from "../../lib/errors.js";
import { escapeLike } from "../../lib/sql.js";

export function toTransactionDto(row: Transaction): TransactionDto {
  return {
    id: row.id,
    accountId: row.accountId,
    categoryId: row.categoryId,
    amountMinor: row.amountMinor,
    occurredOn: row.occurredOn,
    description: row.description,
    notes: row.notes,
    transferId: row.transferId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * Lists transactions newest-first with KEYSET pagination (see Stage 3 §7.4).
 * We fetch `limit + 1` rows: if the extra row exists, there's another page.
 */
export async function listTransactions(
  db: DbExecutor,
  householdId: string,
  query: TransactionListQuery,
): Promise<TransactionPage> {
  const conditions = [eq(transactions.householdId, householdId)];

  if (query.accountId) conditions.push(eq(transactions.accountId, query.accountId));
  if (query.categoryId) {
    // Filtering by a parent ("Food") includes its subcategories ("Groceries", "Coffee").
    conditions.push(
      inArray(
        transactions.categoryId,
        db
          .select({ id: categories.id })
          .from(categories)
          .where(
            and(
              eq(categories.householdId, householdId),
              or(eq(categories.id, query.categoryId), eq(categories.parentId, query.categoryId)),
            ),
          ),
      ),
    );
  }
  if (query.from) conditions.push(gte(transactions.occurredOn, query.from));
  if (query.to) conditions.push(lt(transactions.occurredOn, query.to));
  if (query.type === "income")
    conditions.push(gt(transactions.amountMinor, 0), isNull(transactions.transferId));
  if (query.type === "expense")
    conditions.push(lt(transactions.amountMinor, 0), isNull(transactions.transferId));
  if (query.type === "transfer") conditions.push(sql`${transactions.transferId} is not null`);
  if (query.q)
    conditions.push(sql`${transactions.description} ilike ${`%${escapeLike(query.q)}%`}`);

  if (query.cursor) {
    const cursor = decodeCursor(query.cursor);
    // Row-value comparison: "strictly older than the last row on the previous page".
    // Matches the index (household_id, occurred_on, id) read backwards.
    conditions.push(
      sql`(${transactions.occurredOn}, ${transactions.id}) < (${cursor.occurredOn}, ${cursor.id})`,
    );
  }

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.occurredOn), desc(transactions.id))
    .limit(query.limit + 1);

  const hasMore = rows.length > query.limit;
  const page = hasMore ? rows.slice(0, query.limit) : rows;
  const last = page.at(-1);

  return {
    data: page.map(toTransactionDto),
    nextCursor: hasMore && last ? encodeCursor({ occurredOn: last.occurredOn, id: last.id }) : null,
  };
}

async function findTransaction(db: DbExecutor, householdId: string, id: string) {
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, id)));
  if (!row) throw notFound("Transaction");
  return row;
}

export async function getTransaction(db: DbExecutor, householdId: string, id: string) {
  return toTransactionDto(await findTransaction(db, householdId, id));
}

// ─── Validation helpers (friendly 422s; the DB constraints remain the safety net) ─

async function assertUsableAccount(
  db: DbExecutor,
  householdId: string,
  accountId: string,
  path = "accountId",
) {
  const [account] = await db
    .select({ archivedAt: accounts.archivedAt, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)));
  if (!account)
    throw unprocessable("account_not_found", path, "Account not found in this household.");
  if (account.archivedAt)
    throw unprocessable("account_archived", path, "This account is archived.");
  return account;
}

async function assertUsableCategory(db: DbExecutor, householdId: string, categoryId: string) {
  const [category] = await db
    .select({ archivedAt: categories.archivedAt })
    .from(categories)
    .where(and(eq(categories.householdId, householdId), eq(categories.id, categoryId)));
  if (!category)
    throw unprocessable(
      "category_not_found",
      "categoryId",
      "Category not found in this household.",
    );
  if (category.archivedAt)
    throw unprocessable("category_archived", "categoryId", "This category is archived.");
}

// ─── Writing ─────────────────────────────────────────────────────────────────

export async function createTransaction(
  db: DbExecutor,
  ctx: { householdId: string; userId: string },
  input: CreateTransactionInput,
) {
  await assertUsableAccount(db, ctx.householdId, input.accountId);
  if (input.categoryId) await assertUsableCategory(db, ctx.householdId, input.categoryId);

  const [created] = await db
    .insert(transactions)
    .values({ ...input, householdId: ctx.householdId, createdBy: ctx.userId })
    .returning();
  return toTransactionDto(created!);
}

/** Fields that would break a transfer pair if changed on one half only. */
const TRANSFER_LOCKED_FIELDS = ["accountId", "categoryId", "amountMinor", "occurredOn"] as const;

export async function updateTransaction(
  db: DbExecutor,
  householdId: string,
  id: string,
  input: UpdateTransactionInput,
) {
  const existing = await findTransaction(db, householdId, id);

  if (existing.transferId) {
    const locked = TRANSFER_LOCKED_FIELDS.find((field) => input[field] !== undefined);
    if (locked) {
      throw unprocessable(
        "transfer_locked",
        locked,
        "This transaction is half of a transfer. Delete and recreate the transfer to change it.",
      );
    }
  }
  if (input.accountId && input.accountId !== existing.accountId) {
    await assertUsableAccount(db, householdId, input.accountId);
  }
  if (input.categoryId) await assertUsableCategory(db, householdId, input.categoryId);

  const [updated] = await db
    .update(transactions)
    .set(input)
    .where(and(eq(transactions.householdId, householdId), eq(transactions.id, id)))
    .returning();
  return toTransactionDto(updated!);
}

/** Deleting either half of a transfer deletes both — a transfer is one logical event. */
export async function deleteTransaction(db: DbExecutor, householdId: string, id: string) {
  const existing = await findTransaction(db, householdId, id);
  await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        existing.transferId
          ? eq(transactions.transferId, existing.transferId)
          : eq(transactions.id, id),
      ),
    );
}

/**
 * A transfer writes TWO rows. They must succeed or fail together, so the caller
 * runs this inside a database transaction (atomicity — the "A" in ACID).
 */
export async function createTransfer(
  db: DbExecutor,
  ctx: { householdId: string; userId: string },
  input: CreateTransferInput,
) {
  const from = await assertUsableAccount(db, ctx.householdId, input.fromAccountId, "fromAccountId");
  const to = await assertUsableAccount(db, ctx.householdId, input.toAccountId, "toAccountId");
  if (from.currency !== to.currency) {
    throw unprocessable(
      "currency_mismatch",
      "toAccountId",
      "Transfers between accounts in different currencies aren't supported yet.",
    );
  }

  const transferId = uuidv7();
  const base = {
    householdId: ctx.householdId,
    occurredOn: input.occurredOn,
    description: input.description,
    transferId,
    createdBy: ctx.userId,
  };
  const [outgoing, incoming] = await db
    .insert(transactions)
    .values([
      { ...base, accountId: input.fromAccountId, amountMinor: -input.amountMinor },
      { ...base, accountId: input.toAccountId, amountMinor: input.amountMinor },
    ])
    .returning();

  return { transferId, from: toTransactionDto(outgoing!), to: toTransactionDto(incoming!) };
}
