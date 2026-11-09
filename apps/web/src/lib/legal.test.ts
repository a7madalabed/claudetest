import { describe, expect, it } from "vitest";
import { legalOperator } from "./legal";

describe("legalOperator", () => {
  it("is empty when nothing is configured, rather than showing a placeholder", () => {
    expect(legalOperator({})).toEqual({ name: null, email: null });
    expect(legalOperator({ LEGAL_OPERATOR_NAME: "  ", LEGAL_CONTACT_EMAIL: "" })).toEqual({
      name: null,
      email: null,
    });
  });

  it("returns the configured name and address, trimmed", () => {
    expect(
      legalOperator({ LEGAL_OPERATOR_NAME: " Sam Doe ", LEGAL_CONTACT_EMAIL: " me@example.org " }),
    ).toEqual({ name: "Sam Doe", email: "me@example.org" });
  });

  it("refuses anything that isn't shaped like an address (it ends up in a mailto: link)", () => {
    for (const bad of ["javascript:alert(1)", "a b@c.d", 'x@y"onmouseover="z', "no-at-sign"]) {
      expect(legalOperator({ LEGAL_CONTACT_EMAIL: bad }).email, bad).toBeNull();
    }
  });
});
