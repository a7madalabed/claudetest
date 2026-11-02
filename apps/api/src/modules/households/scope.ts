import {
  and,
  eq,
  householdDataVersions,
  householdMembers,
  households,
  sql,
  type Database,
} from "@ledgerly/db";
import { IdSchema, type HouseholdRole } from "@ledgerly/shared";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { defaultRequiredRole, hasAtLeastRole } from "../../lib/authorization.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { preparedFor } from "../../lib/prepared.js";

declare module "fastify" {
  interface FastifyRequest {
    /** The household this request is scoped to, and the caller's role in it. */
    household?: {
      id: string;
      role: HouseholdRole;
      baseCurrency: string;
      /** Bumped by triggers on every data change: the response cache's key (Stage 12). */
      dataVersion: number;
    };
  }
  interface FastifyContextConfig {
    /** Override the minimum role for a route (default: viewer for GET, editor otherwise). */
    minRole?: HouseholdRole;
  }
}

/**
 * Every route registered inside this plugin lives under
 * /v1/households/:householdId/… and is protected by ONE hook that runs before
 * anything else (even before the body is parsed):
 *
 *   1. Authenticate the caller.
 *   2. Check they're a member of :householdId. If not → 404, NOT 403: we don't
 *      even confirm the household exists (GitHub does the same for private repos).
 *   3. Check their role is high enough for this route → otherwise 403.
 *
 * Putting authorization in one hook means a new route is protected by default.
 * Forgetting a check on one endpoint is how most real-world data leaks happen.
 */
/** Runs on EVERY household request, so it's a prepared statement (Stage 12). */
const membershipStatement = preparedFor((db: Database) =>
  db
    .select({
      role: householdMembers.role,
      baseCurrency: households.baseCurrency,
      // Same query, no extra round-trip: the version rides along with the membership check.
      dataVersion: householdDataVersions.version,
    })
    .from(householdMembers)
    .innerJoin(households, eq(households.id, householdMembers.householdId))
    .leftJoin(
      householdDataVersions,
      eq(householdDataVersions.householdId, householdMembers.householdId),
    )
    .where(
      and(
        eq(householdMembers.householdId, sql.placeholder("householdId")),
        eq(householdMembers.userId, sql.placeholder("userId")),
      ),
    )
    .limit(1)
    .prepare("household_membership"),
);

const scope: FastifyPluginAsync = async (app) => {
  app.decorateRequest("household", undefined);

  app.addHook("onRequest", async (request) => {
    await app.authenticate(request);

    const { householdId } = request.params as { householdId?: string };
    if (!IdSchema.safeParse(householdId).success) throw notFound("Household");

    const [membership] = await membershipStatement(app.db).execute({
      householdId: householdId!,
      userId: request.user!.id,
    });
    if (!membership) throw notFound("Household");

    const required = request.routeOptions.config.minRole ?? defaultRequiredRole(request.method);
    if (!hasAtLeastRole(membership.role, required)) {
      throw forbidden(
        `This action requires the "${required}" role; you are a "${membership.role}".`,
      );
    }

    request.household = {
      id: householdId!,
      role: membership.role,
      baseCurrency: membership.baseCurrency,
      dataVersion: membership.dataVersion ?? 0,
    };
  });
};

/**
 * IMPORTANT: Fastify hooks only apply inside the plugin that adds them
 * ("encapsulation"). Wrapping with fastify-plugin makes this hook apply to the
 * PARENT scope — i.e. to every household route registered next to it. Without
 * this wrapper, the hook would silently protect nothing. (A test caught exactly
 * that while building this stage — see the doc §5.3.)
 */
export const householdScope = fp(scope, { name: "household-scope", dependencies: ["auth"] });
