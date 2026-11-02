import {
  CreateGoalSchema,
  GoalSchema,
  GoalsQuerySchema,
  HouseholdParamsSchema,
  IdSchema,
  UpdateGoalSchema,
} from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { commonProblems, problems } from "../../lib/responses.js";
import * as service from "./goals.service.js";

const GoalParams = HouseholdParamsSchema.extend({ goalId: IdSchema });

export const goalRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Goals"];

  app.get(
    "/goals",
    {
      schema: {
        tags,
        summary: "Savings goals with progress and a projection from the account's recent pace",
        params: HouseholdParamsSchema,
        querystring: GoalsQuerySchema,
        response: { 200: z.object({ data: z.array(GoalSchema) }), ...commonProblems },
      },
    },
    async (request) => ({
      data: await service.listGoals(app.db, request.params.householdId, request.query.today),
    }),
  );

  app.post(
    "/goals",
    {
      schema: {
        tags,
        summary: "Create a savings goal for an account",
        params: HouseholdParamsSchema,
        body: CreateGoalSchema,
        response: { 201: GoalSchema, ...commonProblems, ...problems(422) },
      },
    },
    async (request, reply) => {
      const goal = await service.createGoal(app.db, request.params.householdId, request.body);
      return reply
        .status(201)
        .header("location", `/v1/households/${request.params.householdId}/goals/${goal.id}`)
        .send(goal);
    },
  );

  app.patch(
    "/goals/:goalId",
    {
      schema: {
        tags,
        summary: "Rename a goal or change its target",
        params: GoalParams,
        body: UpdateGoalSchema,
        response: { 200: GoalSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.updateGoal(app.db, request.params.householdId, request.params.goalId, request.body),
  );

  app.delete(
    "/goals/:goalId",
    {
      schema: {
        tags,
        summary: "Delete a goal (the account and its money are untouched)",
        params: GoalParams,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await service.deleteGoal(app.db, request.params.householdId, request.params.goalId);
      return reply.status(204).send(null);
    },
  );
};
