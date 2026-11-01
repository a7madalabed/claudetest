import { z } from "zod";
import {
  CurrencyCodeSchema,
  IdSchema,
  MinorUnitsSchema,
  TimestampSchema,
  nameSchema,
} from "./common.js";

export const AccountTypeSchema = z.enum([
  "checking",
  "savings",
  "credit_card",
  "cash",
  "investment",
  "loan",
]);

export const AccountSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    type: AccountTypeSchema,
    currency: CurrencyCodeSchema,
    openingBalanceMinor: MinorUnitsSchema,
    balanceMinor: MinorUnitsSchema.meta({ description: "Opening balance + all transactions" }),
    archived: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: "Account" });
export type AccountDto = z.infer<typeof AccountSchema>;

export const CreateAccountSchema = z
  .object({
    name: nameSchema(100),
    type: AccountTypeSchema,
    currency: CurrencyCodeSchema,
    openingBalanceMinor: MinorUnitsSchema.default(0),
  })
  .meta({ id: "CreateAccount" });
export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;

export const UpdateAccountSchema = z
  .object({
    name: nameSchema(100),
    type: AccountTypeSchema,
    openingBalanceMinor: MinorUnitsSchema,
    archived: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdateAccount" });
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;

export const AccountListQuerySchema = z.object({
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
