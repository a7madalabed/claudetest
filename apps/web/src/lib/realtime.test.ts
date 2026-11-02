import { describe, expect, it } from "vitest";
import { keysFor } from "./realtime";

describe("keysFor (live event → queries to refetch)", () => {
  it("refreshes everything a new transaction affects, in that household only", () => {
    expect(keysFor({ type: "transactions", householdId: "h1" })).toEqual([
      ["households", "h1", "transactions"],
      ["households", "h1", "reports"],
      ["households", "h1", "budgets"],
      ["households", "h1", "accounts"],
      ["households", "h1", "goals"],
    ]);
  });

  it("maps user-level and membership events", () => {
    expect(keysFor({ type: "notifications" })).toEqual([["notifications"]]);
    expect(keysFor({ type: "membership", householdId: "h1" })).toEqual([
      ["me"],
      ["households", "h1", "members"],
    ]);
  });

  it("ignores events it doesn't know (forward compatible)", () => {
    expect(keysFor({ type: "something_new", householdId: "h1" })).toEqual([]);
    expect(keysFor({ type: "transactions" })).toEqual([]);
  });
});
