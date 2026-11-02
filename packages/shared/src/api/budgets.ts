import { z } from "zod";
import {
  IdSchema,
  IsoDateSchema,
  MinorUnitsSchema,
  TimestampSchema,
  nameSchema,
} from "./common.js";

/** A calendar month, "YYYY-MM". Months come FROM THE CLIENT so "this month" follows the user's clock. */
export const YearMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM")
  .meta({ description: "Calendar month, YYYY-MM", example: "2026-06" });

const PositiveMoney = MinorUnitsSchema.refine((v) => v > 0, "Must be more than zero");

export const BudgetStatusSchema = z.enum(["ok", "warning", "over"]).meta({
  description: "ok < 80% used · warning ≥ 80% · over > 100%",
});

export const BudgetSchema = z
  .object({
    id: IdSchema,
    categoryId: IdSchema,
    name: z.string(),
    icon: z.string().nullable(),
    rollover: z.boolean(),
    startMonth: YearMonthSchema,
    amountMinor: MinorUnitsSchema.meta({ description: "The amount set for this month" }),
    rolloverMinor: MinorUnitsSchema.meta({
      description: "Carried in from earlier months; negative = paying back an overspend",
    }),
    availableMinor: MinorUnitsSchema,
    spentMinor: MinorUnitsSchema.meta({ description: "Net of refunds, incl. subcategories" }),
    remainingMinor: MinorUnitsSchema,
    status: BudgetStatusSchema,
  })
  .meta({ id: "Budget" });
export type BudgetDto = z.infer<typeof BudgetSchema>;

export const BudgetMonthSchema = z
  .object({
    month: YearMonthSchema,
    budgets: z.array(BudgetSchema),
    totals: z.object({
      availableMinor: MinorUnitsSchema,
      spentMinor: MinorUnitsSchema,
      remainingMinor: MinorUnitsSchema,
    }),
    unbudgetedSpendingMinor: MinorUnitsSchema.meta({
      description: "Spending this month in categories without a budget",
    }),
  })
  .meta({ id: "BudgetMonth" });
export type BudgetMonthDto = z.infer<typeof BudgetMonthSchema>;

export const BudgetMonthQuerySchema = z.object({ month: YearMonthSchema });

export const CreateBudgetSchema = z
  .object({
    categoryId: IdSchema,
    amountMinor: PositiveMoney,
    rollover: z.boolean().default(false),
    startMonth: YearMonthSchema.meta({ description: "First month the budget applies to" }),
  })
  .meta({ id: "CreateBudget" });
export type CreateBudgetInput = z.infer<typeof CreateBudgetSchema>;

export const UpdateBudgetSchema = z
  .object({
    amountMinor: PositiveMoney,
    /** Required with amountMinor: the change applies from this month on; earlier months keep their history. */
    effectiveMonth: YearMonthSchema,
    rollover: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update")
  .refine((v) => v.amountMinor === undefined || v.effectiveMonth !== undefined, {
    message: "effectiveMonth is required when changing the amount",
    path: ["effectiveMonth"],
  })
  .meta({ id: "UpdateBudget" });
export type UpdateBudgetInput = z.infer<typeof UpdateBudgetSchema>;

// ─── Goals ───────────────────────────────────────────────────────────────────

export const GoalStatusSchema = z.enum([
  "reached",
  "on_track",
  "behind",
  "no_progress",
  "no_deadline",
]);

export const GoalSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    accountId: IdSchema,
    accountName: z.string(),
    currency: z.string(),
    targetMinor: MinorUnitsSchema,
    targetDate: IsoDateSchema.nullable(),
    balanceMinor: MinorUnitsSchema,
    progress: z.number().meta({ description: "0–1" }),
    remainingMinor: MinorUnitsSchema,
    monthlyPaceMinor: MinorUnitsSchema.meta({
      description: "Average monthly change of the account over the last 6 months",
    }),
    projectedMonth: YearMonthSchema.nullable(),
    requiredMonthlyMinor: MinorUnitsSchema.nullable(),
    status: GoalStatusSchema,
    createdAt: TimestampSchema,
  })
  .meta({ id: "Goal" });
export type GoalDto = z.infer<typeof GoalSchema>;

export const GoalsQuerySchema = z.object({
  today: IsoDateSchema.optional().meta({
    description: "The client's local date (defaults to the server's)",
  }),
});

export const CreateGoalSchema = z
  .object({
    name: nameSchema(60),
    accountId: IdSchema,
    targetMinor: PositiveMoney,
    targetDate: IsoDateSchema.nullable().default(null),
  })
  .meta({ id: "CreateGoal" });
export type CreateGoalInput = z.infer<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z
  .object({
    name: nameSchema(60),
    targetMinor: PositiveMoney,
    targetDate: IsoDateSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdateGoal" });
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>;

// ─── Recurring (detected, read-only) ─────────────────────────────────────────

export const RecurringSeriesSchema = z
  .object({
    key: z.string(),
    description: z.string(),
    cadence: z.enum(["weekly", "twice_monthly", "monthly"]),
    amountMinor: MinorUnitsSchema.meta({ description: "Typical (median) amount, signed" }),
    variable: z.boolean().meta({ description: "Amounts vary by more than 10%" }),
    occurrences: z.int(),
    lastDate: IsoDateSchema,
    nextDate: IsoDateSchema,
    accountId: IdSchema,
    categoryId: IdSchema.nullable(),
  })
  .meta({ id: "RecurringSeries" });
export type RecurringSeriesDto = z.infer<typeof RecurringSeriesSchema>;

export const RecurringReportSchema = z
  .object({ series: z.array(RecurringSeriesSchema) })
  .meta({ id: "RecurringReport" });
export type RecurringReport = z.infer<typeof RecurringReportSchema>;
