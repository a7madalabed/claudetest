import { z } from "zod";
import {
  IdSchema,
  IsoDateSchema,
  MinorUnitsSchema,
  TimestampSchema,
  nameSchema,
} from "./common.js";

// ─── Recurring rules ─────────────────────────────────────────────────────────

export const CadenceSchema = z.enum(["weekly", "twice_monthly", "monthly"]);

export const RecurringRuleSchema = z
  .object({
    id: IdSchema,
    accountId: IdSchema,
    categoryId: IdSchema.nullable(),
    description: z.string(),
    amountMinor: MinorUnitsSchema,
    cadence: CadenceSchema,
    daysOfMonth: z.array(z.int()),
    nextDate: IsoDateSchema,
    active: z.boolean(),
    seriesKey: z.string().nullable(),
    createdAt: TimestampSchema,
  })
  .meta({ id: "RecurringRule" });
export type RecurringRuleDto = z.infer<typeof RecurringRuleSchema>;

export const CreateRecurringRuleSchema = z
  .object({
    accountId: IdSchema,
    categoryId: IdSchema.nullable().default(null),
    description: nameSchema(200),
    amountMinor: MinorUnitsSchema.refine((v) => v !== 0, "Amount can't be zero"),
    cadence: CadenceSchema,
    /** The first date to create a transaction on. Monthly rules repeat on its day of month. */
    nextDate: IsoDateSchema,
    /** Twice-monthly only: the OTHER day of the month (e.g. nextDate the 1st, secondDay 15). */
    secondDay: z.int().min(1).max(31).optional(),
    /** The detected series this comes from (so the UI can show it as automated). */
    seriesKey: z.string().max(300).optional(),
  })
  .refine((v) => v.cadence !== "twice_monthly" || v.secondDay !== undefined, {
    message: "Twice-monthly rules need a second day",
    path: ["secondDay"],
  })
  .meta({ id: "CreateRecurringRule" });
export type CreateRecurringRuleInput = z.infer<typeof CreateRecurringRuleSchema>;

export const UpdateRecurringRuleSchema = z
  .object({ active: z.boolean() })
  .meta({ id: "UpdateRecurringRule" });

// ─── Notifications ───────────────────────────────────────────────────────────

export const NotificationSchema = z
  .object({
    id: IdSchema,
    householdId: IdSchema,
    kind: z.string().meta({ example: "budget.over" }),
    title: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    readAt: TimestampSchema.nullable(),
    createdAt: TimestampSchema,
  })
  .meta({ id: "Notification" });
export type NotificationDto = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z
  .object({ data: z.array(NotificationSchema), unreadCount: z.int() })
  .meta({ id: "NotificationList" });

export const MarkNotificationsReadSchema = z
  .object({
    /** Omit to mark ALL as read. */
    ids: z.array(IdSchema).max(100).optional(),
  })
  .meta({ id: "MarkNotificationsRead" });
