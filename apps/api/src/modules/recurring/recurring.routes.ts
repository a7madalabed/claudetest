import {
  CreateRecurringRuleSchema,
  HouseholdParamsSchema,
  IdSchema,
  RecurringRuleSchema,
  UpdateRecurringRuleSchema,
} from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { commonProblems, problems } from "../../lib/responses.js";
import * as service from "./recurring.service.js";

const RuleParams = HouseholdParamsSchema.extend({ ruleId: IdSchema });

export const recurringRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Recurring rules"];

  app.get(
    "/recurring-rules",
    {
      schema: {
        tags,
        summary: "Rules that create transactions automatically",
        params: HouseholdParamsSchema,
        response: { 200: z.object({ data: z.array(RecurringRuleSchema) }), ...commonProblems },
      },
    },
    async (request) => ({ data: await service.listRules(app.db, request.params.householdId) }),
  );

  app.post(
    "/recurring-rules",
    {
      schema: {
        tags,
        summary: "Automate a recurring transaction (e.g. from a detected bill)",
        params: HouseholdParamsSchema,
        body: CreateRecurringRuleSchema,
        response: { 201: RecurringRuleSchema, ...commonProblems, ...problems(409, 422) },
      },
    },
    async (request, reply) => {
      const rule = await service.createRule(
        app.db,
        { householdId: request.household!.id, userId: request.user!.id },
        request.body,
      );
      return reply.status(201).send(rule);
    },
  );

  app.patch(
    "/recurring-rules/:ruleId",
    {
      schema: {
        tags,
        summary: "Pause or resume a rule",
        params: RuleParams,
        body: UpdateRecurringRuleSchema,
        response: { 200: RecurringRuleSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.setRuleActive(
        app.db,
        request.params.householdId,
        request.params.ruleId,
        request.body.active,
      ),
  );

  app.delete(
    "/recurring-rules/:ruleId",
    {
      schema: {
        tags,
        summary: "Delete a rule (transactions it created are kept)",
        params: RuleParams,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await service.deleteRule(app.db, request.params.householdId, request.params.ruleId);
      return reply.status(204).send(null);
    },
  );
};
