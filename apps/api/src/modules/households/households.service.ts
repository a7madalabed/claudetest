import { asc, eq, householdMembers, households, users, type DbExecutor } from "@ledgerly/db";
import type { MeDto } from "@ledgerly/shared";
import { unauthorized } from "../../lib/errors.js";

/** The current user plus every household they belong to (and their role in each). */
export async function getMe(db: DbExecutor, userId: string): Promise<MeDto> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      totpEnabledAt: users.totpEnabledAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw unauthorized();

  const memberships = await db
    .select({
      id: households.id,
      name: households.name,
      baseCurrency: households.baseCurrency,
      timeZone: households.timeZone,
      role: householdMembers.role,
      createdAt: households.createdAt,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .where(eq(householdMembers.userId, userId))
    .orderBy(asc(households.name));

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    mfaEnabled: user.totpEnabledAt !== null,
    households: memberships.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  };
}
