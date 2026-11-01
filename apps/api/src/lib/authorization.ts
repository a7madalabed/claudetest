import type { HouseholdRole } from "@ledgerly/shared";

/**
 * Roles form a ladder: every owner can do what an editor can, and every editor
 * can do what a viewer can. Checking "at least X" is simpler and safer than
 * listing allowed roles on every route.
 */
const RANK: Record<HouseholdRole, number> = { viewer: 0, editor: 1, owner: 2 };

export function hasAtLeastRole(actual: HouseholdRole, required: HouseholdRole): boolean {
  return RANK[actual] >= RANK[required];
}

/** Safe (read-only) HTTP methods need viewer; everything else needs editor. */
export function defaultRequiredRole(method: string): HouseholdRole {
  return ["GET", "HEAD", "OPTIONS"].includes(method) ? "viewer" : "editor";
}
