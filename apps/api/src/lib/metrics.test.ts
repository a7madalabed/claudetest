import { describe, expect, it } from "vitest";
import { OWNER, request, useTestApp } from "../test/helpers.js";
import { createRegistry, startMetricsServer } from "./metrics.js";

describe("metrics", () => {
  const registry = createRegistry("api", "test-build");
  const ctx = useTestApp({}, { metrics: registry });

  it("records requests by route TEMPLATE, method and status — never by raw URL", async () => {
    const me = (await request(ctx.app, OWNER, { method: "GET", url: "/v1/me" })).json();
    const householdId = me.households[0].id as string;
    await request(ctx.app, OWNER, { method: "GET", url: `/v1/households/${householdId}/accounts` });
    await ctx.app.inject({ method: "GET", url: "/no/such/route" });

    const text = await registry.metrics();
    expect(text).toMatch(
      /ledgerly_http_request_duration_seconds_count\{[^}]*route="\/v1\/households\/:householdId\/accounts"[^}]*status_code="200"/,
    );
    expect(text).toMatch(/route="unmatched"[^}]*status_code="404"/);
    // The household id must never become a label value: one series per household
    // would grow without bound.
    expect(text).not.toContain(householdId);
    // Every series says which service it came from; the build is one info series.
    expect(text).toMatch(/service="api"/);
    expect(text).toMatch(/ledgerly_build_info\{version="test-build",service="api"\} 1/);
  });

  it("serves the registry on its own port, and nothing else", async () => {
    const server = await startMetricsServer(registry, 0, { info() {}, error() {} });
    try {
      const metrics = await fetch(`http://127.0.0.1:${server.port}/metrics`);
      expect(metrics.status).toBe(200);
      expect(metrics.headers.get("content-type")).toContain("text/plain");
      expect(await metrics.text()).toContain("ledgerly_process_cpu_seconds_total");
      expect((await fetch(`http://127.0.0.1:${server.port}/`)).status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});
