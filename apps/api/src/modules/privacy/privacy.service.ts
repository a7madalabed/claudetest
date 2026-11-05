import {
  accounts,
  asc,
  budgetAmounts,
  budgets,
  categories,
  eq,
  goals,
  householdMembers,
  households,
  inArray,
  recurringRules,
  transactions,
  users,
  type Database,
} from "@ledgerly/db";
import { verifyPassword } from "../../auth/password.js";
import { enqueue } from "../../jobs/queue.js";
import { AppError, unauthorized, unprocessable } from "../../lib/errors.js";
import { verifySecondFactor } from "../auth/auth.service.js";

/*
 * Privacy rights (Stage 15): take your data with you, and leave for good.
 * Laws like the GDPR (EU) and CCPA (California) require both; good products
 * offer them anyway.
 */

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * Everything the user can see, as JSON: their profile, and each household
 * they belong to with its accounts, categories, transactions, budgets, goals
 * and recurring rules.
 *
 * Other members appear by NAME and role only: their email addresses are their
 * personal data, not the exporter's.
 */
export async function exportData(db: Database, userId: string) {
  const [user] = await db
    .select({
      email: users.email,
      displayName: users.displayName,
      createdAt: users.createdAt,
      emailVerifiedAt: users.emailVerifiedAt,
      twoFactorEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw unauthorized();

  const memberships = await db
    .select({ household: households, role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .orderBy(asc(households.name));

  const exported = [];
  for (const { household, role } of memberships) {
    const [members, accountRows, categoryRows, transactionRows, budgetRows, goalRows, ruleRows] =
      await Promise.all([
        db
          .select({ name: users.displayName, role: householdMembers.role })
          .from(householdMembers)
          .innerJoin(users, eq(users.id, householdMembers.userId))
          .where(eq(householdMembers.householdId, household.id)),
        db
          .select({
            id: accounts.id,
            name: accounts.name,
            type: accounts.type,
            currency: accounts.currency,
            openingBalanceMinor: accounts.openingBalanceMinor,
            archivedAt: accounts.archivedAt,
          })
          .from(accounts)
          .where(eq(accounts.householdId, household.id)),
        db
          .select({
            id: categories.id,
            parentId: categories.parentId,
            name: categories.name,
            kind: categories.kind,
            archivedAt: categories.archivedAt,
          })
          .from(categories)
          .where(eq(categories.householdId, household.id)),
        db
          .select({
            id: transactions.id,
            accountId: transactions.accountId,
            categoryId: transactions.categoryId,
            occurredOn: transactions.occurredOn,
            description: transactions.description,
            amountMinor: transactions.amountMinor,
            notes: transactions.notes,
            transferId: transactions.transferId,
          })
          .from(transactions)
          .where(eq(transactions.householdId, household.id))
          .orderBy(asc(transactions.occurredOn), asc(transactions.id)),
        db
          .select({
            id: budgets.id,
            categoryId: budgets.categoryId,
            startMonth: budgets.startMonth,
            rollover: budgets.rollover,
          })
          .from(budgets)
          .where(eq(budgets.householdId, household.id)),
        db
          .select({
            id: goals.id,
            accountId: goals.accountId,
            name: goals.name,
            targetMinor: goals.targetMinor,
            targetDate: goals.targetDate,
          })
          .from(goals)
          .where(eq(goals.householdId, household.id)),
        db
          .select({
            id: recurringRules.id,
            accountId: recurringRules.accountId,
            categoryId: recurringRules.categoryId,
            description: recurringRules.description,
            amountMinor: recurringRules.amountMinor,
            cadence: recurringRules.cadence,
            nextDate: recurringRules.nextDate,
            active: recurringRules.active,
          })
          .from(recurringRules)
          .where(eq(recurringRules.householdId, household.id)),
      ]);
    const amounts = budgetRows.length
      ? await db
          .select({
            budgetId: budgetAmounts.budgetId,
            effectiveMonth: budgetAmounts.effectiveMonth,
            amountMinor: budgetAmounts.amountMinor,
          })
          .from(budgetAmounts)
          .where(
            inArray(
              budgetAmounts.budgetId,
              budgetRows.map((b) => b.id),
            ),
          )
      : [];

    exported.push({
      name: household.name,
      yourRole: role,
      baseCurrency: household.baseCurrency,
      timeZone: household.timeZone,
      members,
      accounts: accountRows,
      categories: categoryRows,
      transactions: transactionRows,
      budgets: budgetRows.map((b) => ({
        ...b,
        amounts: amounts.filter((a) => a.budgetId === b.id),
      })),
      goals: goalRows,
      recurringRules: ruleRows,
    });
  }

  return {
    format: "ledgerly-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "Money amounts are integers in minor units (cents): 1234 = 12.34.",
    user,
    households: exported,
  };
}

// ─── Deletion ────────────────────────────────────────────────────────────────

/**
 * Delete the account, after the user re-enters their password (and a 2FA code
 * if it's on): someone at an unlocked laptop mustn't be able to do this.
 *
 *  - A household where they're the ONLY member is deleted with them.
 *  - A household shared with others stays; they just leave it. Unless they're
 *    its only owner: then the others would be left with a household nobody can
 *    manage, so we refuse and say which one to hand over first.
 *  - Their own rows (sessions, notifications…) go via ON DELETE CASCADE;
 *    shared rows they created stay, with "created by" set to null.
 */
export async function deleteAccount(
  db: Database,
  key: Buffer,
  userId: string,
  input: { password: string; code?: string },
) {
  const [user] = await db
    .select({
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      mfa: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    throw unprocessable("wrong_password", "password", "Your password is incorrect.");
  }
  if (user.mfa) {
    if (!input.code) {
      throw unprocessable("code_required", "code", "Enter a code from your authenticator app.");
    }
    await verifySecondFactor(db, key, userId, input.code);
  }

  return db.transaction(async (tx) => {
    // Lock the membership rows of every household involved: a member can't be
    // promoted or removed halfway through this decision (Stage 11's last-owner rule).
    const mine = tx
      .select({ id: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId));
    const rows = await tx
      .select({
        householdId: householdMembers.householdId,
        userId: householdMembers.userId,
        role: householdMembers.role,
        name: households.name,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(inArray(householdMembers.householdId, mine))
      .for("update", { of: householdMembers });

    const byHousehold = new Map<string, typeof rows>();
    for (const row of rows) {
      byHousehold.set(row.householdId, [...(byHousehold.get(row.householdId) ?? []), row]);
    }
    const alone: string[] = [];
    for (const [householdId, members] of byHousehold) {
      const me = members.find((m) => m.userId === userId)!;
      const others = members.filter((m) => m.userId !== userId);
      if (others.length === 0) alone.push(householdId);
      else if (me.role === "owner" && !others.some((m) => m.role === "owner")) {
        throw new AppError(
          409,
          "sole_owner",
          "Hand over your household first",
          `You're the only owner of “${me.name}”, which other people use. Make one of them an owner (or remove them) first.`,
        );
      }
    }

    if (alone.length) await tx.delete(households).where(inArray(households.id, alone));
    // The goodbye email: the account won't exist when the worker sends it.
    await enqueue(tx, "account.email", {
      kind: "account_deleted",
      email: user.email,
      name: user.displayName,
    });
    await tx.delete(users).where(eq(users.id, userId));
    return { deletedHouseholds: alone.length };
  });
}
