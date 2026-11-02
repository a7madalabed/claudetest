import {
  and,
  asc,
  eq,
  householdMembers,
  households,
  users,
  type Database,
  type DbExecutor,
} from "@ledgerly/db";
import type {
  CreateHouseholdInput,
  HouseholdRole,
  MemberDto,
  UpdateHouseholdInput,
} from "@ledgerly/shared";
import { conflict, forbidden, notFound } from "../../lib/errors.js";

export async function listMembers(db: DbExecutor, householdId: string, me: string) {
  const rows = await db
    .select({
      userId: users.id,
      displayName: users.displayName,
      email: users.email,
      role: householdMembers.role,
      joinedAt: householdMembers.createdAt,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.createdAt));
  return rows.map((r): MemberDto => ({
    ...r,
    joinedAt: r.joinedAt.toISOString(),
    isYou: r.userId === me,
  }));
}

/**
 * Every change to membership runs with the household's member rows LOCKED.
 * Without the lock, two owners demoting each other at the same moment could
 * both pass the "is there another owner?" check — and leave the household
 * with no owner at all (a classic race condition: check-then-act).
 */
async function withLockedMembers<T>(
  db: Database,
  householdId: string,
  work: (
    tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
    members: Array<{ userId: string; role: HouseholdRole }>,
  ) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    const members = await tx
      .select({ userId: householdMembers.userId, role: householdMembers.role })
      .from(householdMembers)
      .where(eq(householdMembers.householdId, householdId))
      .for("update");
    return work(tx, members);
  });
}

const lastOwner = () =>
  conflict("last_owner", "A household needs at least one owner. Make someone else an owner first.");

export async function changeRole(
  db: Database,
  householdId: string,
  userId: string,
  role: HouseholdRole,
) {
  return withLockedMembers(db, householdId, async (tx, members) => {
    const member = members.find((m) => m.userId === userId);
    if (!member) throw notFound("Member");
    const owners = members.filter((m) => m.role === "owner").length;
    if (member.role === "owner" && role !== "owner" && owners === 1) throw lastOwner();
    await tx
      .update(householdMembers)
      .set({ role })
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      );
  });
}

/** Remove someone (owners only), or leave yourself (anyone). */
export async function removeMember(
  db: Database,
  householdId: string,
  actor: { userId: string; role: HouseholdRole },
  userId: string,
) {
  if (userId !== actor.userId && actor.role !== "owner") {
    throw forbidden("Only owners can remove other members.");
  }
  return withLockedMembers(db, householdId, async (tx, members) => {
    const member = members.find((m) => m.userId === userId);
    if (!member) throw notFound("Member");
    const owners = members.filter((m) => m.role === "owner").length;
    if (member.role === "owner" && owners === 1) throw lastOwner();
    await tx
      .delete(householdMembers)
      .where(
        and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)),
      );
  });
}

export async function updateHousehold(
  db: DbExecutor,
  householdId: string,
  input: UpdateHouseholdInput,
) {
  await db.update(households).set(input).where(eq(households.id, householdId));
}

/** A new, empty household — its creator is the owner. (Starter categories come in a later exercise.) */
export async function createHousehold(db: Database, userId: string, input: CreateHouseholdInput) {
  return db.transaction(async (tx) => {
    const [household] = await tx
      .insert(households)
      .values({
        name: input.name,
        baseCurrency: input.baseCurrency,
        timeZone: input.timeZone ?? "UTC",
      })
      .returning({ id: households.id });
    await tx.insert(householdMembers).values({ householdId: household!.id, userId, role: "owner" });
    return household!.id;
  });
}
