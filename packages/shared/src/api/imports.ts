import { z } from "zod";
import { IdSchema, TimestampSchema } from "./common.js";

const ColumnSchema = z.int().min(0).max(100);

export const ImportMappingSchema = z
  .object({
    hasHeader: z.boolean(),
    dateColumn: ColumnSchema,
    dateFormat: z.enum(["YMD", "MDY", "DMY"]),
    descriptionColumn: ColumnSchema,
    amount: z.discriminatedUnion("type", [
      z.object({ type: z.literal("single"), column: ColumnSchema, negate: z.boolean() }),
      z.object({ type: z.literal("split"), debitColumn: ColumnSchema, creditColumn: ColumnSchema }),
    ]),
  })
  .meta({ id: "ImportMapping" });

export const ImportStatusSchema = z.enum([
  "uploaded",
  "queued",
  "processing",
  "completed",
  "failed",
  "reverted",
]);

export const ImportSchema = z
  .object({
    id: IdSchema,
    accountId: IdSchema,
    accountName: z.string(),
    fileName: z.string(),
    fileSize: z.int(),
    status: ImportStatusSchema,
    mapping: ImportMappingSchema.nullable(),
    totalRows: z.int(),
    processedRows: z.int(),
    importedCount: z.int(),
    duplicateCount: z.int().meta({ description: "Rows skipped because they were imported before" }),
    errorCount: z.int(),
    errors: z.array(z.object({ row: z.int(), message: z.string() })),
    failureReason: z.string().nullable(),
    createdAt: TimestampSchema,
    completedAt: TimestampSchema.nullable(),
  })
  .meta({ id: "Import" });
export type ImportDto = z.infer<typeof ImportSchema>;

export const UploadImportQuerySchema = z.object({
  accountId: IdSchema,
  fileName: z.string().trim().min(1).max(255),
});

export const ImportUploadResultSchema = z
  .object({
    import: ImportSchema,
    preview: z.object({
      /** The first rows exactly as parsed from the file (header included, if any). */
      rows: z.array(z.array(z.string())),
      guess: z
        .object({
          mapping: ImportMappingSchema,
          dateFormats: z.array(z.enum(["YMD", "MDY", "DMY"])),
        })
        .nullable(),
    }),
  })
  .meta({ id: "ImportUploadResult" });
export type ImportUploadResult = z.infer<typeof ImportUploadResultSchema>;

export const StartImportSchema = z
  .object({ mapping: ImportMappingSchema })
  .meta({ id: "StartImport" });
