import type { TransactionDto } from "@ledgerly/shared";
import { describe, expect, it } from "vitest";
import {
  groupByDay,
  insertSorted,
  matchesFilter,
  removeWhere,
  replaceTransaction,
  type Pages,
} from "./cache";

const tx = (
  id: string,
  occurredOn: string,
  amountMinor = -100,
  extra: Partial<TransactionDto> = {},
): TransactionDto => ({
  id,
  accountId: "acc-1",
  categoryId: null,
  amountMinor,
  occurredOn,
  description: `tx ${id}`,
  notes: null,
  transferId: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

const pages = (...chunks: Array<{ rows: TransactionDto[]; next: string | null }>): Pages => ({
  pages: chunks.map((c) => ({ data: c.rows, nextCursor: c.next })),
  pageParams: chunks.map((_, i) => (i === 0 ? null : `cursor-${i}`)),
});

const ids = (data: Pages) => data.pages.flatMap((p) => p.data.map((t) => t.id));

describe("optimistic cache helpers", () => {
  it("inserts a new row at its sorted position (date desc, then id desc)", () => {
    const data = pages({ rows: [tx("c", "2026-03-10"), tx("a", "2026-03-08")], next: null });
    expect(ids(insertSorted(data, tx("b", "2026-03-09")))).toEqual(["c", "b", "a"]);
    expect(ids(insertSorted(data, tx("z", "2026-03-10")))).toEqual(["z", "c", "a"]); // same day, newer id first
  });

  it("doesn't append to the end when unloaded pages might hold the right spot", () => {
    const data = pages({ rows: [tx("c", "2026-03-10")], next: "cursor-1" });
    expect(ids(insertSorted(data, tx("old", "2020-01-01")))).toEqual(["c"]);
  });

  it("appends at the very end when the list is fully loaded", () => {
    const data = pages({ rows: [tx("c", "2026-03-10")], next: null });
    expect(ids(insertSorted(data, tx("old", "2020-01-01")))).toEqual(["c", "old"]);
  });

  it("never mutates the original data", () => {
    const data = pages({ rows: [tx("a", "2026-03-08")], next: null });
    const before = JSON.stringify(data);
    insertSorted(data, tx("b", "2026-03-09"));
    removeWhere(data, () => true);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("moves an edited row when its date changes, and drops it if it no longer matches", () => {
    const data = pages({
      rows: [tx("c", "2026-03-10"), tx("b", "2026-03-09"), tx("a", "2026-03-08")],
      next: null,
    });
    expect(ids(replaceTransaction(data, tx("a", "2026-03-11"), true))).toEqual(["a", "c", "b"]);
    expect(ids(replaceTransaction(data, tx("a", "2026-03-08"), false))).toEqual(["c", "b"]);
  });
});

describe("matchesFilter", () => {
  const coffee = tx("1", "2026-03-10", -450, {
    description: "Blue Bottle Coffee",
    categoryId: "cat-coffee",
  });
  const parentOf = (id: string) => (id === "cat-coffee" ? "cat-food" : null);

  it("mirrors the API's filters", () => {
    expect(matchesFilter(coffee, { type: "expense" })).toBe(true);
    expect(matchesFilter(coffee, { type: "income" })).toBe(false);
    expect(matchesFilter(coffee, { q: "BOTTLE" })).toBe(true);
    expect(matchesFilter(coffee, { from: "2026-03-01", to: "2026-04-01" })).toBe(true);
    expect(matchesFilter(coffee, { to: "2026-03-10" })).toBe(false); // `to` is exclusive
    expect(matchesFilter(coffee, { categoryId: "cat-food" }, parentOf)).toBe(true); // parent includes children
    expect(matchesFilter(coffee, { accountId: "acc-2" })).toBe(false);
  });

  it("never counts transfers as income or expense", () => {
    const transfer = tx("t", "2026-03-10", -500, { transferId: "tr-1" });
    expect(matchesFilter(transfer, { type: "expense" })).toBe(false);
    expect(matchesFilter(transfer, { type: "transfer" })).toBe(true);
  });
});

describe("groupByDay", () => {
  it("groups by date with a daily net that ignores transfers", () => {
    const groups = groupByDay([
      tx("a", "2026-03-10", -500),
      tx("b", "2026-03-10", 2000),
      tx("c", "2026-03-10", -999, { transferId: "t" }),
      tx("d", "2026-03-09", -100),
    ]);
    expect(groups.map((g) => [g.date, g.totalMinor, g.rows.length])).toEqual([
      ["2026-03-10", 1500, 3],
      ["2026-03-09", -100, 1],
    ]);
  });
});
