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
