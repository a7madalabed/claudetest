import {
  CashflowReportSchema,
  DailyCashflowReportSchema,
  DashboardLayoutSchema,
  DateRangeQuerySchema,
  HouseholdParamsSchema,
  NetWorthReportSchema,
  SpendingByCategoryQuerySchema,
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
        summary: "Spending per top-level category, or per subcategory with ?parentId=",
        params: HouseholdParamsSchema,
        querystring: SpendingByCategoryQuerySchema,
        response: { 200: SpendingByCategoryReportSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.spendingByCategoryReport(app.db, request.params.householdId, request.query),
  );

  app.get(
    "/reports/net-worth",
    {
      schema: {
        tags,
        summary: "Net worth at the end of each month (household base currency)",
        params: HouseholdParamsSchema,
        querystring: DateRangeQuerySchema,
        response: { 200: NetWorthReportSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.netWorthReport(app.db, request.params.householdId, {
        ...request.query,
        currency: request.household!.baseCurrency,
      }),
  );

  app.get(
    "/reports/daily-cashflow",
    {
      schema: {
        tags,
        summary: "Money in and out per day (month-to-date comparisons, spending pace)",
        params: HouseholdParamsSchema,
        querystring: DateRangeQuerySchema,
        response: { 200: DailyCashflowReportSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.dailyCashflowReport(app.db, request.params.householdId, request.query),
  );

  app.get(
    "/dashboard",
    {
      schema: {
        tags: ["Households"],
        summary: "Your dashboard layout for this household",
        params: HouseholdParamsSchema,
        response: { 200: DashboardLayoutSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.getDashboardLayout(app.db, request.user!.id, request.params.householdId),
  );

  app.put(
    "/dashboard",
    {
      // A personal preference: viewers may arrange THEIR OWN dashboard.
      config: { minRole: "viewer" },
      schema: {
        tags: ["Households"],
        summary: "Save your dashboard layout for this household",
        params: HouseholdParamsSchema,
        body: DashboardLayoutSchema,
        response: { 200: DashboardLayoutSchema, ...commonProblems },
      },
    },
    async (request) =>
      service.saveDashboardLayout(
        app.db,
        request.user!.id,
        request.params.householdId,
        request.body.widgets,
      ),
  );
};
