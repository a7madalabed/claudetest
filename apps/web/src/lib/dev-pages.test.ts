import { describe, expect, it } from "vitest";
import { designPageEnabled } from "./dev-pages";

describe("designPageEnabled", () => {
  it("is on while developing and testing", () => {
    expect(designPageEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(designPageEnabled({ NODE_ENV: "test" })).toBe(true);
  });

  it("is off in production, unless switched on on purpose", () => {
    expect(designPageEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(designPageEnabled({ NODE_ENV: "production", SHOW_DESIGN_PAGE: "false" })).toBe(false);
    expect(designPageEnabled({ NODE_ENV: "production", SHOW_DESIGN_PAGE: "true" })).toBe(true);
  });
});
