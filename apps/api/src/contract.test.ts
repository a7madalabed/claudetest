import { describe, expect, it } from "vitest";
import { useTestApp } from "./test/helpers.js";

/**
 * CONTRACT SNAPSHOT. The API's OpenAPI document is generated from the same Zod
 * schemas that validate every request, so it is exactly what the API accepts
 * and returns. Its committed copy, `apps/api/openapi.json`, is the contract.
 *
 * Change a route, a field, a status code or an error shape and this test
 * fails until you accept the change:
 *
 *   pnpm --filter @ledgerly/api exec vitest run src/contract.test.ts -u
 *
 * The point is not to forbid change. It is that a contract change can never
 * slip into a pull request unnoticed: it shows up as a readable diff of
 * openapi.json, and the reviewer asks "will this break a client?".
 */
describe("API contract", () => {
  const ctx = useTestApp();

  it("matches the committed OpenAPI document", async () => {
    const spec = (await ctx.app.inject({ method: "GET", url: "/openapi.json" })).json();
    // The version moves with every release; it isn't part of the contract.
    spec.info.version = "<version>";
    await expect(`${JSON.stringify(spec, null, 2)}\n`).toMatchFileSnapshot("../openapi.json");
  });
});
