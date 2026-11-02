import {
  AccountListQuerySchema,
  AccountSchema,
  CreateAccountSchema,
  HouseholdParamsSchema,
  IdSchema,
  UpdateAccountSchema,
} from "@ledgerly/shared";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { commonProblems, problems } from "../../lib/responses.js";
import * as service from "./accounts.service.js";

const AccountParams = HouseholdParamsSchema.extend({ accountId: IdSchema });

/**
 * Routes are thin: declare the contract (params/query/body/responses), call the
 * service, return. Validation happens BEFORE the handler runs, so inside it
 * `request.body` is already typed and trusted.
 */
export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Accounts"];

  app.get(
    "/accounts",
    {
      config: { cache: true }, // per household data version (Stage 12)
      schema: {
        tags,
        summary: "List accounts with current balances",
        params: HouseholdParamsSchema,
        querystring: AccountListQuerySchema,
        response: { 200: z.object({ data: z.array(AccountSchema) }), ...commonProblems },
      },
    },
    async (request) => ({
      data: await service.listAccounts(app.db, request.params.householdId, request.query),
    }),
  );

  app.post(
    "/accounts",
    {
      schema: {
        tags,
        summary: "Create an account",
        params: HouseholdParamsSchema,
        body: CreateAccountSchema,
        response: { 201: AccountSchema, ...commonProblems, ...problems(409) },
      },
    },
    async (request, reply) => {
      const account = await service.createAccount(app.db, request.params.householdId, request.body);
      // 201 Created + Location header: the REST convention for "here's your new resource".
      return reply
        .status(201)
        .header("location", `/v1/households/${request.params.householdId}/accounts/${account.id}`)
        .send(account);
    },
  );

  app.get(
    "/accounts/:accountId",
    {
      schema: {
        tags,
        summary: "Get an account",
        params: AccountParams,
        response: { 200: AccountSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.getAccount(app.db, request.params.householdId, request.params.accountId),
  );

  app.patch(
    "/accounts/:accountId",
    {
      schema: {
        tags,
        summary: "Update an account (send only the fields to change)",
        params: AccountParams,
        body: UpdateAccountSchema,
        response: { 200: AccountSchema, ...commonProblems, ...problems(409) },
      },
    },
    async (request) =>
      service.updateAccount(
        app.db,
        request.params.householdId,
        request.params.accountId,
        request.body,
      ),
  );

  app.delete(
    "/accounts/:accountId",
    {
      schema: {
        tags,
        summary: "Delete an account (only if it has no transactions — otherwise archive it)",
        params: AccountParams,
        response: { 204: z.null(), ...commonProblems, ...problems(409) },
      },
    },
    async (request, reply) => {
      await service.deleteAccount(app.db, request.params.householdId, request.params.accountId);
      return reply.status(204).send(null);
    },
  );
};
