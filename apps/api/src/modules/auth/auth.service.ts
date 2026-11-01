import {
  and,
  categories,
  eq,
  householdMembers,
  households,
  isNull,
  isPgError,
  lt,
  or,
  recoveryCodes,
  sql,
  users,
  type DbExecutor,
  type DbTransaction,
} from "@ledgerly/db";
import type { SignupInput } from "@ledgerly/shared";
import { decrypt, encrypt } from "../../auth/encryption.js";
import {
  hashPassword,
  needsRehash,
  passwordWeakness,
  verifyPassword,
} from "../../auth/password.js";
import { sha256 } from "../../auth/tokens.js";
import {
  createTotpSecret,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  totpUri,
  verifyTotp,
} from "../../auth/totp.js";
import { AppError, conflict, unprocessable } from "../../lib/errors.js";

/** ONE message for "no such email" and "wrong password" — never reveal which. */
const invalidCredentials = () =>
  new AppError(
    401,
    "invalid_credentials",
    "Invalid email or password",
    "Check your details and try again.",
  );

const invalidCode = () =>
  new AppError(
    401,
    "invalid_mfa_code",
    "Invalid code",
    "That code is incorrect or has already been used.",
  );

// ─── Sign-up ─────────────────────────────────────────────────────────────────

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

/**
 * Creates the user, their first household and starter categories — in ONE
 * database transaction, so a crash can never leave a user without a household.
 */
export async function signup(tx: DbTransaction, input: SignupInput) {
  const weakness = passwordWeakness(input.password, input);
  if (weakness) throw unprocessable("weak_password", "password", weakness);

  let userId: string;
  try {
    const [user] = await tx
      .insert(users)
      .values({
        email: input.email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password),
      })
      .returning({ id: users.id });
    userId = user!.id;
  } catch (error) {
    if (isPgError(error, "uniqueViolation", "users_email_lower_key")) {
      throw conflict("email_taken", "An account with this email already exists. Try signing in.");
    }
    throw error;
  }

  const [household] = await tx
    .insert(households)
    .values({ name: `${input.displayName.split(" ")[0]}'s Household`, baseCurrency: "USD" })
    .returning({ id: households.id });
  await tx.insert(householdMembers).values({ householdId: household!.id, userId, role: "owner" });

  for (const [index, spec] of STARTER_CATEGORIES.entries()) {
    const [parent] = await tx
      .insert(categories)
      .values({
        householdId: household!.id,
        name: spec.name,
        kind: spec.kind,
        icon: spec.icon,
        sortOrder: index,
      })
      .returning({ id: categories.id });
    if (spec.children?.length) {
      await tx.insert(categories).values(
        spec.children.map((name, childIndex) => ({
          householdId: household!.id,
          parentId: parent!.id,
          name,
          kind: spec.kind,
          sortOrder: childIndex,
        })),
      );
    }
  }
  return userId;
}

// ─── Sign-in ─────────────────────────────────────────────────────────────────

/** Checks email + password. Returns the user, or throws the same error for every failure. */
export async function verifyCredentials(db: DbExecutor, email: string, password: string) {
  const [user] = await db
    .select({ id: users.id, passwordHash: users.passwordHash, totpEnabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);

  // Always run the (slow) verification, even for unknown emails: equal timing.
  const valid = await verifyPassword(user?.passwordHash, password);
  if (!user || !valid) throw invalidCredentials();

  // Transparent upgrades: if we've raised the hashing cost since this password
  // was set, re-hash it now while we have the plain text.
  if (user.passwordHash && needsRehash(user.passwordHash)) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, user.id));
  }
  return { userId: user.id, mfaEnabled: user.totpEnabledAt !== null };
}

/**
 * Verifies a second-factor code: a 6-digit TOTP code, or a one-time recovery code.
 * Each successful use is recorded ATOMICALLY in the same UPDATE that checks it,
 * so a code can't be used twice — not even by two simultaneous requests.
 */
export async function verifySecondFactor(
  db: DbExecutor,
  key: Buffer,
  userId: string,
  code: string,
) {
  const [user] = await db
    .select({ secret: users.totpSecretEncrypted, enabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user?.secret || !user.enabledAt) throw invalidCode();

  const step = verifyTotp(decrypt(user.secret, key), code.replace(/\s/g, ""));
  if (step !== null) {
    const updated = await db
      .update(users)
      .set({ totpLastUsedStep: step })
      .where(
        and(
          eq(users.id, userId),
          or(isNull(users.totpLastUsedStep), lt(users.totpLastUsedStep, step)),
        ),
      )
      .returning({ id: users.id });
    if (updated.length === 1) return "totp" as const;
    throw invalidCode(); // a valid code, but already used: replay attempt
  }

  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(recoveryCodes.userId, userId),
        eq(recoveryCodes.codeHash, sha256(normalizeRecoveryCode(code))),
        isNull(recoveryCodes.usedAt),
      ),
    )
    .returning({ id: recoveryCodes.id });
  if (used.length === 1) return "recovery_code" as const;

  throw invalidCode();
}

// ─── Password change ─────────────────────────────────────────────────────────

export async function changePassword(
  db: DbExecutor,
  user: { id: string; email: string; displayName: string },
  currentPassword: string,
  newPassword: string,
) {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, user.id));
  if (!(await verifyPassword(row?.passwordHash, currentPassword))) {
    throw unprocessable("wrong_password", "currentPassword", "Your current password is incorrect.");
  }
  const weakness = passwordWeakness(newPassword, user);
  if (weakness) throw unprocessable("weak_password", "newPassword", weakness);
  if (currentPassword === newPassword) {
    throw unprocessable("same_password", "newPassword", "Choose a password you haven't just used.");
  }
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, user.id));
}

// ─── Two-factor (TOTP) management ────────────────────────────────────────────

/** Step 1: create a secret and show it as a QR code. NOT active until confirmed. */
export async function startTotpSetup(
  db: DbExecutor,
  key: Buffer,
  user: { id: string; email: string; mfaEnabled: boolean },
) {
  if (user.mfaEnabled)
    throw conflict("mfa_already_enabled", "Two-factor authentication is already on.");
  const secret = createTotpSecret();
  await db
    .update(users)
    .set({ totpSecretEncrypted: encrypt(secret, key), totpLastUsedStep: null })
    .where(eq(users.id, user.id));
  return { secret, otpauthUri: totpUri(secret, user.email) };
}

/**
 * Step 2: the user proves their app works by entering a code. Only then is 2FA
 * switched on — otherwise a mis-scanned QR code would lock them out.
 */
export async function confirmTotpSetup(db: DbExecutor, key: Buffer, userId: string, code: string) {
  const [user] = await db
    .select({ secret: users.totpSecretEncrypted, enabledAt: users.totpEnabledAt })
    .from(users)
    .where(eq(users.id, userId));
  if (user?.enabledAt)
    throw conflict("mfa_already_enabled", "Two-factor authentication is already on.");
  if (!user?.secret) throw conflict("mfa_setup_required", "Start the setup first.");

  const step = verifyTotp(decrypt(user.secret, key), code.replace(/\s/g, ""));
  if (step === null) throw invalidCode();

  const codes = generateRecoveryCodes();
  await db
    .update(users)
    .set({ totpEnabledAt: sql`now()`, totpLastUsedStep: step })
    .where(eq(users.id, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db
    .insert(recoveryCodes)
    .values(codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })));
  return codes;
}

/** Turning 2FA OFF requires BOTH the password and a current code. */
export async function disableTotp(
  db: DbExecutor,
  key: Buffer,
  userId: string,
  password: string,
  code: string,
) {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  if (!(await verifyPassword(row?.passwordHash, password))) {
    throw unprocessable("wrong_password", "password", "Your password is incorrect.");
  }
  await verifySecondFactor(db, key, userId, code);
  await db
    .update(users)
    .set({ totpSecretEncrypted: null, totpEnabledAt: null, totpLastUsedStep: null })
    .where(eq(users.id, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
}
