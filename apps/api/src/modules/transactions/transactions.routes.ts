import {
  BulkTransactionActionSchema,
  BulkTransactionResultSchema,
  CreateTransactionSchema,
  CreateTransferSchema,
  HouseholdParamsSchema,
  IdSchema,
  TransactionListQuerySchema,
  TransactionFilterSchema,
  TransactionPageSchema,
  TransactionSchema,
  TransactionSummarySchema,
  TransferSchema,
  UpdateTransactionSchema,
} from "@ledgerly/shared";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { idempotent } from "../../lib/idempotency.js";
import { commonProblems, problems } from "../../lib/responses.js";
import * as service from "./transactions.service.js";

const TransactionParams = HouseholdParamsSchema.extend({ transactionId: IdSchema });

const IdempotencyHeaders = z.object({
  "idempotency-key": z.string().optional().meta({
    description:
      "Any unique string (e.g. a UUID). Retrying with the same key never creates a duplicate.",
  }),
});

export const transactionRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Transactions"];

  app.get(
    "/transactions",
    {
      config: { cache: true }, // per household data version (Stage 12)
      schema: {
        tags,
        summary: "List transactions, newest first (keyset-paginated)",
        params: HouseholdParamsSchema,
        querystring: TransactionListQuerySchema,
        response: { 200: TransactionPageSchema, ...commonProblems },
      },
    },
    async (request) => service.listTransactions(app.db, request.params.householdId, request.query),
  );

  app.post(
    "/transactions",
    {
      schema: {
        tags,
        summary: "Record a transaction",
        params: HouseholdParamsSchema,
        headers: IdempotencyHeaders,
        body: CreateTransactionSchema,
        response: { 201: TransactionSchema, ...commonProblems, ...problems(409, 422) },
      },
    },
    async (request, reply) => {
      const ctx = { householdId: request.params.householdId, userId: request.user!.id };
      const transaction = await idempotent(app.db, request, reply, 201, (tx) =>
        service.createTransaction(tx, ctx, request.body),
      );
      return reply
        .header("location", `/v1/households/${ctx.householdId}/transactions/${transaction.id}`)
        .send(transaction);
    },
  );

  // Registered BEFORE "/transactions/:transactionId" for readability; Fastify's router
  // matches static segments ("summary", "bulk") ahead of parameters anyway.
  app.get(
    "/transactions/summary",
    {
      config: { cache: true }, // per household data version (Stage 12)
      schema: {
        tags,
        summary: "Count and totals for the same filters as the list",
        params: HouseholdParamsSchema,
        querystring: TransactionFilterSchema,
        response: { 200: TransactionSummarySchema, ...commonProblems },
      },
    },
    async (request) =>
      service.summarizeTransactions(app.db, request.params.householdId, request.query),
  );

  app.post(
    "/transactions/bulk",
    {
      schema: {
        tags,
        summary: "Delete or re-categorise up to 500 transactions atomically",
        params: HouseholdParamsSchema,
        body: BulkTransactionActionSchema,
        response: { 200: BulkTransactionResultSchema, ...commonProblems, ...problems(422) },
      },
    },
    async (request) =>
      app.db.transaction((tx) =>
        service.bulkTransactions(tx, request.params.householdId, request.body),
      ),
  );

  app.get(
    "/transactions/:transactionId",
    {
      schema: {
        tags,
        summary: "Get a transaction",
        params: TransactionParams,
        response: { 200: TransactionSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.getTransaction(app.db, request.params.householdId, request.params.transactionId),
  );

  app.patch(
    "/transactions/:transactionId",
    {
      schema: {
        tags,
        summary: "Update a transaction (send only the fields to change)",
        params: TransactionParams,
        body: UpdateTransactionSchema,
        response: { 200: TransactionSchema, ...commonProblems, ...problems(422) },
      },
    },
    async (request) =>
      service.updateTransaction(
        app.db,
        request.params.householdId,
        request.params.transactionId,
        request.body,
      ),
  );

  app.delete(
    "/transactions/:transactionId",
    {
      schema: {
        tags,
        summary: "Delete a transaction (deleting half of a transfer deletes both halves)",
        params: TransactionParams,
        response: { 204: z.null(), ...commonProblems },
      },
    },
    async (request, reply) => {
      await app.db.transaction((tx) =>
        service.deleteTransaction(tx, request.params.householdId, request.params.transactionId),
      );
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/transfers",
    {
      schema: {
        tags,
        summary: "Move money between two of the household's accounts",
        params: HouseholdParamsSchema,
        headers: IdempotencyHeaders,
        body: CreateTransferSchema,
        response: { 201: TransferSchema, ...commonProblems, ...problems(422) },
      },
    },
    async (request, reply) => {
      const ctx = { householdId: request.params.householdId, userId: request.user!.id };
      const transfer = await idempotent(app.db, request, reply, 201, (tx) =>
        service.createTransfer(tx, ctx, request.body),
      );
      return reply.send(transfer);
    },
  );
};
