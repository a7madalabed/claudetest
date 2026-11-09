import {
  BudgetMonthQuerySchema,
  BudgetMonthSchema,
  BudgetSchema,
  CreateBudgetSchema,
  HouseholdParamsSchema,
  IdSchema,
  UpdateBudgetSchema,
} from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { commonProblems, problems } from "../../lib/responses.js";
import * as service from "./budgets.service.js";

const BudgetParams = HouseholdParamsSchema.extend({ budgetId: IdSchema });

export const budgetRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Budgets"];

  app.get(
    "/budgets",
    {
      config: { cache: true }, // per household data version (Stage 12)
      schema: {
        tags,
        summary: "Every budget for one month: amount, rollover, spent, remaining, status",
        params: HouseholdParamsSchema,
        querystring: BudgetMonthQuerySchema,
        response: { 200: BudgetMonthSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.getBudgetMonth(
        app.db,
        request.params.householdId,
        request.query.month,
        request.household!.today,
      ),
  );

  app.post(
    "/budgets",
    {
      schema: {
        tags,
        summary: "Budget an expense category",
        params: HouseholdParamsSchema,
        body: CreateBudgetSchema,
        response: { 201: BudgetSchema, ...commonProblems, ...problems(409, 422) },
      },
    },
    async (request, reply) => {
      const budget = await service.createBudget(
        app.db,
        request.params.householdId,
        request.body,
        request.household!.today,
      );
      return reply
        .status(201)
        .header("location", `/v1/households/${request.params.householdId}/budgets/${budget.id}`)
        .send(budget);
    },
  );

  app.patch(
    "/budgets/:budgetId",
    {
      schema: {
        tags,
        summary: "Change the amount (from a month onward) or the rollover setting",
        params: BudgetParams,
        body: UpdateBudgetSchema,
        response: { 200: BudgetSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.updateBudget(
        app.db,
        request.params.householdId,
        request.params.budgetId,
        request.body,
        request.household!.timeZone,
      ),
  );

  app.delete(
    "/budgets/:budgetId",
    {
      schema: {
        tags,
        summary: "Delete a budget and its history",
        params: BudgetParams,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await service.deleteBudget(app.db, request.params.householdId, request.params.budgetId);
      return reply.status(204).send(null);
    },
  );
};
