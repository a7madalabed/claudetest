import {
  accounts,
  and,
  asc,
  eq,
  isNull,
  isPgError,
  sql,
  transactions,
  type Account,
  type DbExecutor,
} from "@ledgerly/db";
import type { AccountDto, CreateAccountInput, UpdateAccountInput } from "@ledgerly/shared";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";

/*
 * Services hold the business rules. They know nothing about HTTP (no request,
 * no reply, no status codes except via AppError), so the same logic can be reused
 * by a background job or a CLI script later.
 */

/**
 * Balance = opening balance + every transaction (a correlated subquery per account).
 *
 * The subquery uses an explicit alias (t) and a fully-qualified "accounts"."id".
 * Drizzle writes bare column names (`id`) in single-table queries, and inside the
 * subquery a bare `id` would mean the TRANSACTION's id — the correlation would
 * silently never match. (Our tests caught this; see the doc §5.3.)
 */
const balanceMinor = sql<number>`(${accounts.openingBalanceMinor} + coalesce((
    select sum(t.amount_minor) from ${transactions} as t
    where t.account_id = "accounts"."id"
  ), 0))::bigint`.mapWith(Number);

/**
 * DB row → API shape. We never return raw rows: the API contract must not change
 * just because a column is added, and internal fields (household_id) stay private.
 */
function toDto(row: Account & { balanceMinor: number }): AccountDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    currency: row.currency,
    openingBalanceMinor: row.openingBalanceMinor,
    balanceMinor: row.balanceMinor,
    archived: row.archivedAt !== null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const selectWithBalance = (db: DbExecutor) =>
  db.select({ account: accounts, balanceMinor }).from(accounts);

export async function listAccounts(
  db: DbExecutor,
  householdId: string,
  options: { includeArchived: boolean },
) {
  const rows = await selectWithBalance(db)
    .where(
      and(
        eq(accounts.householdId, householdId),
        options.includeArchived ? undefined : isNull(accounts.archivedAt),
      ),
    )
    .orderBy(asc(accounts.name));
  return rows.map((row) => toDto({ ...row.account, balanceMinor: row.balanceMinor }));
}

export async function getAccount(db: DbExecutor, householdId: string, accountId: string) {
  const [row] = await selectWithBalance(db).where(
    and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)),
  );
  if (!row) throw notFound("Account");
  return toDto({ ...row.account, balanceMinor: row.balanceMinor });
}

const nameTaken = (name: string) =>
  conflict("account_name_taken", `An account named "${name}" already exists in this household.`);

/**
 * A household keeps its books in ONE currency, its base currency (Stage 16).
 * Every total (spending, cash flow, budgets) adds amounts across accounts, and
 * ¥10,000 is not $100.00: until amounts are converted, a second currency would
 * make every total wrong without anyone noticing.
 */
export async function createAccount(
  db: DbExecutor,
  household: { id: string; baseCurrency: string },
  input: CreateAccountInput,
) {
  const householdId = household.id;
  const currency = input.currency ?? household.baseCurrency;
  if (currency !== household.baseCurrency) {
    throw unprocessable(
      "currency_not_supported",
      "currency",
      `This household keeps its books in ${household.baseCurrency}. Accounts in other currencies aren't supported yet.`,
    );
  }
  try {
    const [created] = await db
      .insert(accounts)
      .values({ householdId, ...input, currency })
      .returning();
    return getAccount(db, householdId, created!.id);
  } catch (error) {
    // Let the UNIQUE constraint decide, instead of "check then insert" (which races).
    if (isPgError(error, "uniqueViolation", "accounts_household_id_name_key"))
      throw nameTaken(input.name);
    throw error;
  }
}

export async function updateAccount(
  db: DbExecutor,
  householdId: string,
  accountId: string,
  input: UpdateAccountInput,
) {
  const { archived, ...fields } = input;
  try {
    const [updated] = await db
      .update(accounts)
      .set({
        ...fields,
        // Keep the ORIGINAL archive time if it's archived again.
        ...(archived !== undefined && {
          archivedAt: archived ? sql`coalesce(${accounts.archivedAt}, now())` : null,
        }),
      })
      .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)))
      .returning({ id: accounts.id });
    if (!updated) throw notFound("Account");
  } catch (error) {
    if (isPgError(error, "uniqueViolation", "accounts_household_id_name_key"))
      throw nameTaken(input.name ?? "");
    throw error;
  }
  return getAccount(db, householdId, accountId);
}

export async function deleteAccount(db: DbExecutor, householdId: string, accountId: string) {
  try {
    const deleted = await db
      .delete(accounts)
      .where(and(eq(accounts.householdId, householdId), eq(accounts.id, accountId)))
      .returning({ id: accounts.id });
    if (deleted.length === 0) throw notFound("Account");
  } catch (error) {
    if (isPgError(error, "foreignKeyViolation")) {
      throw conflict(
        "account_has_transactions",
        "This account has transactions. Archive it instead, so its history is kept.",
      );
    }
    throw error;
  }
}
