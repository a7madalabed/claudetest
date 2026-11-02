import { z } from "zod";
import { IdSchema, IsoDateSchema, MinorUnitsSchema } from "./common.js";

export const DateRangeQuerySchema = z
  .object({
    from: IsoDateSchema.meta({ description: "Inclusive" }),
    to: IsoDateSchema.meta({ description: "Exclusive" }),
  })
  .refine((range) => range.from < range.to, {
    message: "`from` must be before `to`",
    path: ["to"],
  });

export const CashflowReportSchema = z
  .object({
    months: z.array(
      z.object({
        month: z.string().meta({ example: "2026-03" }),
        incomeMinor: MinorUnitsSchema,
        spendingMinor: MinorUnitsSchema,
        netMinor: MinorUnitsSchema,
      }),
    ),
  })
  .meta({ id: "CashflowReport" });

export const SpendingByCategoryReportSchema = z
  .object({
    totalMinor: MinorUnitsSchema,
    categories: z.array(
      z.object({
        categoryId: IdSchema,
        name: z.string(),
        icon: z.string().nullable(),
        spendingMinor: MinorUnitsSchema,
        share: z.number().meta({ description: "0–1 fraction of total spending" }),
      }),
    ),
  })
  .meta({ id: "SpendingByCategoryReport" });

export const SpendingByCategoryQuerySchema = DateRangeQuerySchema.and(
  z.object({
    parentId: IdSchema.optional().meta({
      description: "Drill into one top-level category's subcategories",
    }),
  }),
);

export const NetWorthReportSchema = z
  .object({
    currency: z.string(),
    points: z.array(
      z.object({ month: z.string().meta({ example: "2026-03" }), balanceMinor: MinorUnitsSchema }),
    ),
  })
  .meta({ id: "NetWorthReport" });
export type NetWorthReport = z.infer<typeof NetWorthReportSchema>;

export const DailyCashflowReportSchema = z
  .object({
    days: z.array(
      z.object({
        date: IsoDateSchema,
        incomeMinor: MinorUnitsSchema,
        spendingMinor: MinorUnitsSchema,
      }),
    ),
  })
  .meta({ id: "DailyCashflowReport" });
export type DailyCashflowReport = z.infer<typeof DailyCashflowReportSchema>;

/** Rearrangeable dashboard widgets (the "Trends" section). Unknown ids are rejected. */
export const DashboardWidgetSchema = z.enum([
  "cashflow",
  "spending-by-category",
  "net-worth",
  "accounts",
  "recent-activity",
]);
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;

export const DashboardLayoutSchema = z
  .object({
    widgets: z
      .array(DashboardWidgetSchema)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length, "Each widget can appear only once"),
  })
  .meta({ id: "DashboardLayout" });
export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;
