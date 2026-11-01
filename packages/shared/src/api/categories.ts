import { z } from "zod";
import { IdSchema, TimestampSchema, nameSchema } from "./common.js";

export const CategoryKindSchema = z.enum(["income", "expense"]);

export const CategorySchema = z
  .object({
    id: IdSchema,
    parentId: IdSchema.nullable(),
    name: z.string(),
    kind: CategoryKindSchema,
    icon: z.string().nullable(),
    sortOrder: z.int(),
    archived: z.boolean(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: "Category" });
export type CategoryDto = z.infer<typeof CategorySchema>;

const iconSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/, "Use a lucide icon name like 'shopping-cart'");

export const CreateCategorySchema = z
  .object({
    name: nameSchema(50),
    kind: CategoryKindSchema,
    parentId: IdSchema.nullable().default(null),
    icon: iconSchema.nullable().default(null),
    sortOrder: z.int().min(0).max(10_000).default(0),
  })
  .meta({ id: "CreateCategory" });
export type CreateCategoryInput = z.infer<typeof CreateCategorySchema>;

export const UpdateCategorySchema = z
  .object({
    name: nameSchema(50),
    icon: iconSchema.nullable(),
    sortOrder: z.int().min(0).max(10_000),
    archived: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update")
  .meta({ id: "UpdateCategory" });
export type UpdateCategoryInput = z.infer<typeof UpdateCategorySchema>;
