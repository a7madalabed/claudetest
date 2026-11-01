import {
  CashflowReportSchema,
  DateRangeQuerySchema,
  HouseholdParamsSchema,
  SpendingByCategoryReportSchema,
} from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { commonProblems } from "../../lib/responses.js";
import * as service from "./reports.service.js";

export const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Reports"];

  app.get(
    "/reports/cashflow",
    {
      schema: {
        tags,
        summary: "Income, spending and net per month (transfers excluded)",
        params: HouseholdParamsSchema,
        querystring: DateRangeQuerySchema,
        response: { 200: CashflowReportSchema, ...commonProblems },
      },
    },
    async (request) => service.cashflowReport(app.db, request.params.householdId, request.query),
  );

  app.get(
    "/reports/spending-by-category",
    {
      schema: {
        tags,
        summary: "Spending per top-level category",
        params: HouseholdParamsSchema,
        querystring: DateRangeQuerySchema,
        response: { 200: SpendingByCategoryReportSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.spendingByCategoryReport(app.db, request.params.householdId, request.query),
  );
};
