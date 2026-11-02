import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("resolves conflicts between standard utilities", () => {
    expect(cn("px-4", "px-6")).toBe("px-6");
  });

  it("knows our custom type scale is a font SIZE, not a colour", () => {
    expect(cn("text-display", "text-negative")).toBe("text-display text-negative");
    expect(cn("text-caption", "text-muted-foreground")).toBe("text-caption text-muted-foreground");
    expect(cn("text-caption", "text-sm")).toBe("text-sm");
  });
});
