import { and, asc, eq, householdMembers, households } from "@ledgerly/db";
import {
  HouseholdParamsSchema,
  HouseholdSchema,
  MeSchema,
  type HouseholdDto,
} from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { notFound } from "../../lib/errors.js";
import { commonProblems, problems } from "../../lib/responses.js";

const membershipColumns = {
  id: households.id,
  name: households.name,
  baseCurrency: households.baseCurrency,
  role: householdMembers.role,
  createdAt: households.createdAt,
};

const toDto = (row: {
  id: string;
  name: string;
  baseCurrency: string;
  role: HouseholdDto["role"];
  createdAt: Date;
}): HouseholdDto => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
});

/** GET /v1/me — who am I, and which households can I access? */
export const meRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/me",
    {
      onRequest: app.authenticate,
      schema: {
        tags: ["Households"],
        summary: "The current user and their households",
        response: { 200: MeSchema, ...problems(401) },
      },
    },
    async (request) => {
      const memberships = await app.db
        .select(membershipColumns)
        .from(householdMembers)
        .innerJoin(households, eq(households.id, householdMembers.householdId))
        .where(eq(householdMembers.userId, request.user!.id))
        .orderBy(asc(households.name));
      return { ...request.user!, households: memberships.map(toDto) };
    },
  );
};

/** GET /v1/households/:householdId (registered inside the household scope). */
export const householdRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/",
    {
      schema: {
        tags: ["Households"],
        summary: "Get a household",
        params: HouseholdParamsSchema,
        response: { 200: HouseholdSchema, ...commonProblems },
      },
    },
    async (request) => {
      const [row] = await app.db
        .select(membershipColumns)
        .from(householdMembers)
        .innerJoin(households, eq(households.id, householdMembers.householdId))
        .where(
          and(
            eq(householdMembers.householdId, request.params.householdId),
            eq(householdMembers.userId, request.user!.id),
          ),
        );
      if (!row) throw notFound("Household");
      return toDto(row);
    },
  );
};
