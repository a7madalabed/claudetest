import { z } from "zod";
import { CurrencyCodeSchema, IdSchema, TimestampSchema } from "./common.js";

export const HouseholdRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type HouseholdRole = z.infer<typeof HouseholdRoleSchema>;

export const HouseholdSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    baseCurrency: CurrencyCodeSchema,
    role: HouseholdRoleSchema.meta({ description: "YOUR role in this household" }),
    createdAt: TimestampSchema,
  })
  .meta({ id: "Household" });
export type HouseholdDto = z.infer<typeof HouseholdSchema>;

export const MeSchema = z
  .object({
    id: IdSchema,
    email: z.email(),
    displayName: z.string(),
    households: z.array(HouseholdSchema),
  })
  .meta({ id: "Me" });
export type MeDto = z.infer<typeof MeSchema>;

export const HouseholdParamsSchema = z.object({ householdId: IdSchema });
