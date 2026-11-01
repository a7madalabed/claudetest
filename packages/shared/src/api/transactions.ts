import { z } from "zod";
import {
  IdSchema,
  IsoDateSchema,
  ListQuerySchema,
  MinorUnitsSchema,
  TimestampSchema,
  paginated,
} from "./common.js";

export const TransactionSchema = z
  .object({
    id: IdSchema,
    accountId: IdSchema,
    categoryId: IdSchema.nullable(),
    amountMinor: MinorUnitsSchema.meta({ description: "Signed: positive = in, negative = out" }),
    occurredOn: IsoDateSchema,
    description: z.string(),
    notes: z.string().nullable(),
    transferId: IdSchema.nullable(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: "Transaction" });
export type TransactionDto = z.infer<typeof TransactionSchema>;

const descriptionSchema = z.string().trim().min(1).max(200);
const notesSchema = z.string().trim().max(2000).nullable();
const nonZeroAmount = MinorUnitsSchema.refine((value) => value !== 0, "Amount can't be zero");

export const CreateTransactionSchema = z
  .object({
    accountId: IdSchema,
    categoryId: IdSchema.nullable().default(null),
    amountMinor: nonZeroAmount,
    occurredOn: IsoDateSchema,
    description: descriptionSchema,
    notes: notesSchema.default(null),
  })
  .meta({ id: "CreateTransaction" });
export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>;

export const UpdateTransactionSchema = z
  .object({
    accountId: IdSchema,
    categoryId: IdSchema.nullable(),
    amountMinor: nonZeroAmount,
    occurredOn: IsoDateSchema,
    description: descriptionSchema,
    notes: notesSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdateTransaction" });
export type UpdateTransactionInput = z.infer<typeof UpdateTransactionSchema>;

export const CreateTransferSchema = z
  .object({
    fromAccountId: IdSchema,
    toAccountId: IdSchema,
    amountMinor: MinorUnitsSchema.refine((value) => value > 0, "Must be a positive amount"),
    occurredOn: IsoDateSchema,
    description: descriptionSchema.default("Transfer"),
  })
  .refine((value) => value.fromAccountId !== value.toAccountId, {
    message: "Choose two different accounts",
    path: ["toAccountId"],
  })
  .meta({ id: "CreateTransfer" });
export type CreateTransferInput = z.infer<typeof CreateTransferSchema>;

export const TransferSchema = z
  .object({ transferId: IdSchema, from: TransactionSchema, to: TransactionSchema })
  .meta({ id: "Transfer" });

export const TransactionListQuerySchema = ListQuerySchema.extend({
  accountId: IdSchema.optional(),
  categoryId: IdSchema.optional(),
  from: IsoDateSchema.optional().meta({ description: "Inclusive start date" }),
  to: IsoDateSchema.optional().meta({ description: "Exclusive end date" }),
  type: z.enum(["income", "expense", "transfer"]).optional(),
  q: z.string().trim().min(1).max(100).optional().meta({ description: "Search descriptions" }),
});
export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;

export const TransactionPageSchema = paginated(TransactionSchema).meta({ id: "TransactionPage" });
export type TransactionPage = z.infer<typeof TransactionPageSchema>;
