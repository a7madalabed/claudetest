import {
  accounts,
  and,
  desc,
  eq,
  imports,
  transactions,
  type Database,
  type DbExecutor,
  type Import,
} from "@ledgerly/db";
import { guessMapping, type ImportDto } from "@ledgerly/shared";
import type { z } from "zod";
import type { ImportMappingSchema } from "@ledgerly/shared";
import { conflict, notFound, unprocessable } from "../../lib/errors.js";
import { enqueue } from "../../jobs/queue.js";
import { assertUsableAccount } from "../transactions/transactions.service.js";
import { MAX_IMPORT_ROWS, parseCsv } from "./csv.js";

type Mapping = z.infer<typeof ImportMappingSchema>;

export function toImportDto(row: Import, accountName: string): ImportDto {
  return {
    id: row.id,
    accountId: row.accountId,
    accountName,
    fileName: row.fileName,
    fileSize: row.fileSize,
    status: row.status,
    mapping: (row.mapping as Mapping | null) ?? null,
    totalRows: row.totalRows,
    processedRows: row.processedRows,
    importedCount: row.importedCount,
    duplicateCount: row.duplicateCount,
    errorCount: row.errorCount,
    errors: row.errors,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

const withAccount = (db: DbExecutor, householdId: string, importId?: string) =>
  db
    .select({ import: imports, accountName: accounts.name })
    .from(imports)
    .innerJoin(accounts, eq(accounts.id, imports.accountId))
    .where(
      and(eq(imports.householdId, householdId), importId ? eq(imports.id, importId) : undefined),
    );

export async function getImport(db: DbExecutor, householdId: string, importId: string) {
  const [row] = await withAccount(db, householdId, importId);
  if (!row) throw notFound("Import");
  return toImportDto(row.import, row.accountName);
}

export async function listImports(db: DbExecutor, householdId: string) {
  const rows = await withAccount(db, householdId).orderBy(desc(imports.createdAt)).limit(20);
  return rows.map((r) => toImportDto(r.import, r.accountName));
}

/**
 * Step 1: store the file and show what's in it. Nothing is imported yet — the
 * user checks the preview and confirms the column mapping first.
 */
export async function uploadImport(
  db: Database,
  ctx: { householdId: string; userId: string },
  input: { accountId: string; fileName: string; text: string },
) {
  const account = await assertUsableAccount(db, ctx.householdId, input.accountId);

  let rows: string[][];
  try {
    rows = parseCsv(input.text);
  } catch {
    throw unprocessable("unreadable_file", "file", "This doesn't look like a CSV file.");
  }
  if (rows.length === 0) throw unprocessable("empty_file", "file", "The file has no rows.");
  if (rows.length > MAX_IMPORT_ROWS) {
    throw unprocessable(
      "too_many_rows",
      "file",
      `Files can have at most ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows. Split it into smaller date ranges.`,
    );
  }

  const [created] = await db
    .insert(imports)
    .values({
      householdId: ctx.householdId,
      accountId: input.accountId,
      createdBy: ctx.userId,
      fileName: input.fileName,
      fileSize: Buffer.byteLength(input.text),
      fileText: input.text,
      totalRows: rows.length,
    })
    .returning();
  const accountName = (await getImport(db, ctx.householdId, created!.id)).accountName;

  return {
    import: toImportDto(created!, accountName),
    preview: { rows: rows.slice(0, 20), guess: guessMapping(rows, account.currency) },
  };
}

/**
 * Step 2: the user confirmed a mapping. Save it and queue the work — in ONE
 * transaction, so there's never a "queued" import without a job (or a job for
 * an import that wasn't saved). The response returns at once (202 Accepted);
 * the client polls GET /imports/:id for progress.
 */
export async function startImport(
  db: Database,
  householdId: string,
  importId: string,
  mapping: Mapping,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(imports)
      .where(and(eq(imports.householdId, householdId), eq(imports.id, importId)))
      .for("update"); // two clicks on "Import" must not queue two jobs
    if (!row) throw notFound("Import");
    if (row.status !== "uploaded") {
      throw conflict("import_already_started", `This import is already ${row.status}.`);
    }
    const width = Math.max(...parseCsv(row.fileText ?? "").map((r) => r.length));
    const columns = [
      mapping.dateColumn,
      mapping.descriptionColumn,
      ...(mapping.amount.type === "single"
        ? [mapping.amount.column]
        : [mapping.amount.debitColumn, mapping.amount.creditColumn]),
    ];
    if (columns.some((c) => c >= width)) {
      throw unprocessable(
        "column_out_of_range",
        "mapping",
        "The mapping points at a column the file doesn't have.",
      );
    }
    await tx
      .update(imports)
      .set({
        status: "queued",
        mapping,
        totalRows: mapping.hasHeader ? row.totalRows - 1 : row.totalRows,
      })
      .where(eq(imports.id, importId));
    await enqueue(tx, "import.process", { importId }, { singletonKey: `import:${importId}` });
    return getImport(tx, householdId, importId);
  });
}

/** Undo: delete every transaction this import created. The import stays, marked "reverted". */
export async function revertImport(db: Database, householdId: string, importId: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ status: imports.status })
      .from(imports)
      .where(and(eq(imports.householdId, householdId), eq(imports.id, importId)))
      .for("update");
    if (!row) throw notFound("Import");
    if (row.status !== "completed") {
      throw conflict(
        "import_not_revertible",
        `Only completed imports can be undone (this one is ${row.status}).`,
      );
    }
    await tx
      .delete(transactions)
      .where(and(eq(transactions.householdId, householdId), eq(transactions.importId, importId)));
    await tx.update(imports).set({ status: "reverted" }).where(eq(imports.id, importId));
    return getImport(tx, householdId, importId);
  });
}

/** Discard an upload that was never started. */
export async function discardImport(db: Database, householdId: string, importId: string) {
  const deleted = await db
    .delete(imports)
    .where(
      and(
        eq(imports.householdId, householdId),
        eq(imports.id, importId),
        eq(imports.status, "uploaded"),
      ),
    )
    .returning({ id: imports.id });
  if (deleted.length === 0) {
    await getImport(db, householdId, importId); // 404 if it doesn't exist…
    throw conflict("import_already_started", "Only imports that haven't started can be discarded.");
  }
}
