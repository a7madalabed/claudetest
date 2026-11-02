import { createHash } from "node:crypto";
import {
  accounts,
  and,
  categories,
  count,
  eq,
  gte,
  imports,
  isNull,
  sql,
  transactions,
} from "@ledgerly/db";
import { applyMapping, normaliseDescription, type ImportMapping } from "@ledgerly/shared";
import { z } from "zod";
import { PermanentJobError, defineJob, type JobContext } from "../../jobs/registry.js";
import { notify } from "../notifications/notifications.service.js";
import { parseCsv } from "./csv.js";

const CHUNK = 500;
const MAX_STORED_ERRORS = 50;

/**
 * "Same bank row" detection. Banks don't give rows stable ids, so we derive one
 * from what they do give us. The OCCURRENCE number matters: two identical $4.50
 * coffees on the same day are two real purchases, not a duplicate.
 */
export function fingerprint(
  accountId: string,
  row: { occurredOn: string; amountMinor: number; description: string },
  occurrence: number,
) {
  return createHash("sha256")
    .update(
      [
        accountId,
        row.occurredOn,
        row.amountMinor,
        normaliseDescription(row.description),
        occurrence,
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Suggest a category from history: whichever category this household used
 * most often for the same (normalised) payee and direction. "Trader Joe's #123"
 * was Groceries 40 times → the import puts it in Groceries.
 */
async function learnCategories(ctx: JobContext, householdId: string) {
  const rows = await ctx.db
    .select({
      description: transactions.description,
      positive: sql<boolean>`${transactions.amountMinor} > 0`,
      categoryId: transactions.categoryId,
      n: count(),
    })
    .from(transactions)
    .innerJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.householdId, householdId),
        isNull(categories.archivedAt),
        gte(transactions.occurredOn, sql`current_date - 365`),
      ),
    )
    .groupBy(
      transactions.description,
      sql`${transactions.amountMinor} > 0`,
      transactions.categoryId,
    );
  const best = new Map<string, { categoryId: string; n: number }>();
  for (const row of rows) {
    const key = `${normaliseDescription(row.description)}|${row.positive ? "in" : "out"}`;
    const current = best.get(key);
    if (!current || row.n > current.n) best.set(key, { categoryId: row.categoryId!, n: row.n });
  }
  return (description: string, amountMinor: number) =>
    best.get(`${normaliseDescription(description)}|${amountMinor > 0 ? "in" : "out"}`)
      ?.categoryId ?? null;
}

export const importJob = defineJob({
  name: "import.process",
  payload: z.object({ importId: z.uuid() }),
  leaseSeconds: 120,
  maxAttempts: 3,
  run: async ({ importId }, ctx) => {
    const { db, log, signal } = ctx;
    const [row] = await db
      .select({ import: imports, currency: accounts.currency })
      .from(imports)
      .innerJoin(accounts, eq(accounts.id, imports.accountId))
      .where(eq(imports.id, importId));
    if (!row) throw new PermanentJobError("Import not found");
    const job = row.import;
    // Idempotent: a retry of an import that already finished does nothing.
    if (job.status !== "queued" && job.status !== "processing") return;

    const fail = async (reason: string) => {
      await db
        .update(imports)
        .set({ status: "failed", failureReason: reason, fileText: null })
        .where(eq(imports.id, importId));
      await notify(db, {
        householdId: job.householdId,
        userIds: job.createdBy ? [job.createdBy] : [],
        kind: "import.failed",
        title: `Import of ${job.fileName} failed`,
        body: reason,
        link: `/app/${job.householdId}/imports`,
        dedupeKey: `import:${importId}:failed`,
      });
    };

    try {
      await db.update(imports).set({ status: "processing" }).where(eq(imports.id, importId));
      const mapping = job.mapping as ImportMapping;
      const rows = parseCsv(job.fileText ?? "").slice(mapping.hasHeader ? 1 : 0);
      const categoryFor = await learnCategories(ctx, job.householdId);

      // Map every row first (pure and fast), collecting row-level errors.
      const errors: Array<{ row: number; message: string }> = [];
      const seen = new Map<string, number>();
      const values: Array<typeof transactions.$inferInsert> = [];
      rows.forEach((cells, index) => {
        const mapped = applyMapping(cells, mapping, row.currency);
        const rowNumber = index + 1 + (mapping.hasHeader ? 1 : 0); // as the user sees it in a spreadsheet
        if (!mapped.ok) {
          errors.push({ row: rowNumber, message: mapped.error });
          return;
        }
        const key = `${mapped.occurredOn}|${mapped.amountMinor}|${normaliseDescription(mapped.description)}`;
        const occurrence = (seen.get(key) ?? 0) + 1;
        seen.set(key, occurrence);
        values.push({
          householdId: job.householdId,
          accountId: job.accountId,
          categoryId: categoryFor(mapped.description, mapped.amountMinor),
          amountMinor: mapped.amountMinor,
          occurredOn: mapped.occurredOn,
          description: mapped.description,
          createdBy: job.createdBy,
          importId,
          importFingerprint: fingerprint(job.accountId, mapped, occurrence),
        });
      });

      // Insert in chunks: progress is visible, and each chunk is one short transaction.
      for (let start = 0; start < values.length; start += CHUNK) {
        // Shutting down? Stop between chunks; the retry resumes safely (inserts are idempotent).
        if (signal.aborted) throw new Error("Worker shutting down; will resume");
        await db.transaction(async (tx) => {
          await tx
            .insert(transactions)
            .values(values.slice(start, start + CHUNK))
            // Already imported (this file before, or an overlapping export)? Skip it.
            .onConflictDoNothing({
              target: [transactions.accountId, transactions.importFingerprint],
              where: sql`import_fingerprint is not null`,
            });
          await tx
            .update(imports)
            .set({ processedRows: Math.min(start + CHUNK, values.length) + errors.length })
            .where(eq(imports.id, importId));
        });
      }

      // Count from the database, not from memory: correct even if this is a retry.
      const [{ n: importedCount } = { n: 0 }] = await db
        .select({ n: count() })
        .from(transactions)
        .where(eq(transactions.importId, importId));
      await db
        .update(imports)
        .set({
          status: "completed",
          processedRows: rows.length,
          importedCount,
          duplicateCount: values.length - importedCount,
          errorCount: errors.length,
          errors: errors.slice(0, MAX_STORED_ERRORS),
          completedAt: new Date(),
          fileText: null, // data minimisation: the raw statement isn't needed any more
        })
        .where(eq(imports.id, importId));

      const skipped = values.length - importedCount;
      await notify(db, {
        householdId: job.householdId,
        userIds: job.createdBy ? [job.createdBy] : [],
        kind: "import.completed",
        title: `Imported ${importedCount.toLocaleString("en-US")} transactions`,
        body: [
          `From ${job.fileName}.`,
          skipped ? `${skipped} already imported, skipped.` : null,
          errors.length ? `${errors.length} rows couldn't be read.` : null,
        ]
          .filter(Boolean)
          .join(" "),
        link: `/app/${job.householdId}/imports`,
        dedupeKey: `import:${importId}:completed`,
      });
      log.info({ importedCount, skipped, errors: errors.length }, "Import completed");
    } catch (error) {
      const finalAttempt = ctx.job.attempts >= (importJob.maxAttempts ?? 1);
      if (error instanceof PermanentJobError || finalAttempt) {
        await fail(error instanceof Error ? error.message : "Unexpected error");
      }
      throw error;
    }
  },
});
