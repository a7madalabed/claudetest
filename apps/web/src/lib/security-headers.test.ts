import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, staticSecurityHeaders } from "./security-headers";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }),
  );

describe("Content Security Policy", () => {
  const production = directives(contentSecurityPolicy("n0nce", { https: true, dev: false }));

  it("lets a script run only with this response's nonce", () => {
    expect(production["script-src"]).toEqual(["'self'", "'nonce-n0nce'", "'strict-dynamic'"]);
    // The two words that would undo the whole policy for scripts:
    expect(production["script-src"]).not.toContain("'unsafe-inline'");
    expect(production["script-src"]).not.toContain("'unsafe-eval'");
  });

  it("forbids framing, plugins and foreign form targets", () => {
    expect(production["frame-ancestors"]).toEqual(["'none'"]);
    expect(production["object-src"]).toEqual(["'none'"]);
    expect(production["form-action"]).toEqual(["'self'"]);
    expect(production["base-uri"]).toEqual(["'self'"]);
  });

  it("upgrades insecure requests only behind HTTPS (plain-http localhost must keep working)", () => {
    expect(production).toHaveProperty("upgrade-insecure-requests");
    const local = directives(contentSecurityPolicy("n", { https: false, dev: false }));
    expect(local).not.toHaveProperty("upgrade-insecure-requests");
  });

  it("allows eval in development only (React's dev tooling)", () => {
    const dev = directives(contentSecurityPolicy("n", { https: false, dev: true }));
    expect(dev["script-src"]).toContain("'unsafe-eval'");
  });

  it("sends the companion headers", () => {
    expect(staticSecurityHeaders).toMatchObject({
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    });
  });
});
