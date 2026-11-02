import { eq, imports, jobs, transactions } from "@ledgerly/db";
import { describe, expect, it } from "vitest";
import { OWNER, VIEWER, jobRunner, request, useTestApp } from "../../test/helpers.js";

const CSV = `Date,Description,Amount,Balance
10/01/2026,Trader Joe's #552,-54.20,1000.00
10/02/2026,Blue Bottle Coffee,-4.50,995.50
10/02/2026,Blue Bottle Coffee,-4.50,991.00
10/03/2026,Mystery Payee,-12.00,979.00
not-a-date,Broken row,-1.00,978.00
10/05/2026,Refund from shop,25.00,1003.00
`;

const MAPPING = {
  hasHeader: true,
  dateColumn: 0,
  dateFormat: "MDY",
  descriptionColumn: 1,
  amount: { type: "single", column: 2, negate: false },
};

describe("CSV imports", () => {
  const ctx = useTestApp();
  const base = () => `/v1/households/${ctx.fixtures.householdId}`;
  const checking = async () =>
    (await request(ctx.app, OWNER, { method: "GET", url: `${base()}/accounts` }))
      .json()
      .data.find((a: { name: string }) => a.name === "Everyday Checking");
  const upload = async (body = CSV, user = OWNER, contentType = "text/csv") => {
    const account = await checking();
    return request(ctx.app, user, {
      method: "POST",
      url: `${base()}/imports?accountId=${account.id}&fileName=october.csv`,
      headers: { "content-type": contentType },
      payload: body,
    });
  };
  const start = (id: string) =>
    request(ctx.app, OWNER, {
      method: "POST",
      url: `${base()}/imports/${id}/start`,
      payload: { mapping: MAPPING },
    });
  const get = async (id: string) =>
    (await request(ctx.app, OWNER, { method: "GET", url: `${base()}/imports/${id}` })).json();
  const importedRows = (id: string) =>
    ctx.db.select().from(transactions).where(eq(transactions.importId, id));

  async function importOnce(body = CSV) {
    const uploaded = (await upload(body)).json();
    await start(uploaded.import.id);
    await jobRunner(ctx.db).run();
    return get(uploaded.import.id);
  }

  it("previews the file and guesses the mapping before importing anything", async () => {
    const response = await upload();
    expect(response.statusCode).toBe(201);
    const { import: created, preview } = response.json();
    expect(created).toMatchObject({ status: "uploaded", fileName: "october.csv", totalRows: 7 });
    expect(preview.rows[0]).toEqual(["Date", "Description", "Amount", "Balance"]);
    expect(preview.guess.mapping).toEqual({ ...MAPPING, dateFormat: "MDY" });
    expect(preview.guess.dateFormats).toEqual(["MDY", "DMY"]); // ambiguous: the UI asks
    expect(await importedRows(created.id)).toHaveLength(0);
  });

  it("imports in the background: 202 now, results after the job runs", async () => {
    const { import: created } = (await upload()).json();
    const started = await start(created.id);
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ status: "queued", totalRows: 6 });
    // The job was enqueued in the same transaction as the status change.
    expect(await ctx.db.select().from(jobs).where(eq(jobs.name, "import.process"))).toHaveLength(1);

    await jobRunner(ctx.db).run();
    const done = await get(created.id);
    expect(done).toMatchObject({
      status: "completed",
      importedCount: 5, // including BOTH identical coffees: same day, two purchases
      duplicateCount: 0,
      errorCount: 1,
      errors: [{ row: 6, message: expect.stringMatching(/date/i) }],
    });
    // The raw bank statement is deleted once it's no longer needed.
    const [stored] = await ctx.db.select().from(imports).where(eq(imports.id, created.id));
    expect(stored!.fileText).toBeNull();
  });

  it("learns categories from history and leaves unknown payees uncategorised", async () => {
    const done = await importOnce();
    const rows = await importedRows(done.id);
    const categories = (
      await request(ctx.app, OWNER, { method: "GET", url: `${base()}/categories` })
    ).json().data;
    const nameOf = (id: string | null) =>
      categories.find((c: { id: string }) => c.id === id)?.name ?? null;
    const byDescription = Object.fromEntries(
      rows.map((r) => [r.description, nameOf(r.categoryId)]),
    );
    expect(byDescription["Trader Joe's #552"]).toBe("Groceries");
    expect(byDescription["Blue Bottle Coffee"]).toBe("Coffee");
    expect(byDescription["Mystery Payee"]).toBeNull();
  });

  it("skips rows that were already imported (overlapping bank exports)", async () => {
    await importOnce();
    const overlapping = `${CSV}10/06/2026,New purchase,-9.99,993.01\n`;
    const second = await importOnce(overlapping);
    expect(second).toMatchObject({ importedCount: 1, duplicateCount: 5 });
  });

  it("is safe to run twice (a retried job doesn't duplicate anything)", async () => {
    const done = await importOnce();
    // Simulate a crash right before the job was marked done, then a retry.
    await ctx.db.update(imports).set({ status: "processing" }).where(eq(imports.id, done.id));
    await ctx.db.update(imports).set({ fileText: CSV }).where(eq(imports.id, done.id));
    await ctx.db.insert(jobs).values({ name: "import.process", payload: { importId: done.id } });
    await jobRunner(ctx.db).run();
    expect(await get(done.id)).toMatchObject({ importedCount: 5, duplicateCount: 0 });
    expect(await importedRows(done.id)).toHaveLength(5);
  });

  it("notifies the person who uploaded it", async () => {
    await importOnce();
    const list = (
      await request(ctx.app, OWNER, { method: "GET", url: "/v1/notifications" })
    ).json();
    expect(list.data[0]).toMatchObject({
      kind: "import.completed",
      title: "Imported 5 transactions",
    });
    const viewer = (
      await request(ctx.app, VIEWER, { method: "GET", url: "/v1/notifications" })
    ).json();
    expect(viewer.data.some((n: { kind: string }) => n.kind === "import.completed")).toBe(false);
  });

  it("can be undone, once", async () => {
    const done = await importOnce();
    const revert = () =>
      request(ctx.app, OWNER, { method: "POST", url: `${base()}/imports/${done.id}/revert` });
    const first = await revert();
    expect(first.statusCode).toBe(200);
    expect(first.json().status).toBe("reverted");
    expect(await importedRows(done.id)).toHaveLength(0);
    expect((await revert()).statusCode).toBe(409);
  });

  it("can't be started twice", async () => {
    const { import: created } = (await upload()).json();
    expect((await start(created.id)).statusCode).toBe(202);
    const again = await start(created.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("import_already_started");
  });

  it("rejects bad files and bad mappings clearly", async () => {
    expect((await upload("")).json().code).toBe("empty_file");
    const { import: created } = (await upload("Date,Amount\n2026-10-01,5\n")).json();
    const bad = await request(ctx.app, OWNER, {
      method: "POST",
      url: `${base()}/imports/${created.id}/start`,
      payload: { mapping: { ...MAPPING, descriptionColumn: 7 } },
    });
    expect(bad.json().code).toBe("column_out_of_range");
  });

  it("accepts only text/csv bodies, within the size limit", async () => {
    expect((await upload(CSV, OWNER, "text/plain")).statusCode).toBe(415);
    expect((await upload("x".repeat(5 * 1024 * 1024 + 1))).statusCode).toBe(413);
  });

  it("lets only editors and owners import", async () => {
    expect((await upload(CSV, VIEWER)).statusCode).toBe(403);
  });
});
