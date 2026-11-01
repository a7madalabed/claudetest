// @vitest-environment node
/**
 * Accessibility as a test: every text/background pair in our design tokens must
 * meet WCAG 2.2 contrast minimums, in BOTH themes. If someone tweaks a colour and
 * makes text unreadable, CI fails — the design system can't silently regress.
 *
 *   4.5 : 1  normal text (WCAG AA, success criterion 1.4.3)
 *   3   : 1  large text and UI components like borders/icons (1.4.11)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { wcagContrast } from "culori";
import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

function readTokens(selector: ":root" | ".dark"): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  const block = css.slice(start, css.indexOf("\n}", start));
  const tokens: Record<string, string> = {};
  for (const match of block.matchAll(/--([\w-]+):\s*(oklch\([^)]*\))\s*;/g)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

const AA_TEXT = 4.5;

const pairs: Array<[foreground: string, background: string, minimum: number]> = [
  ["foreground", "background", AA_TEXT],
  ["surface-foreground", "surface", AA_TEXT],
  ["muted-foreground", "background", AA_TEXT],
  ["muted-foreground", "surface", AA_TEXT],
  ["muted-foreground", "muted", AA_TEXT],
  ["primary-foreground", "primary", AA_TEXT],
  ["primary", "background", AA_TEXT],
  ["primary", "primary-subtle", AA_TEXT],
  ["positive", "background", AA_TEXT],
  ["positive", "surface", AA_TEXT],
  ["positive", "positive-subtle", AA_TEXT],
  ["negative", "background", AA_TEXT],
  ["negative", "surface", AA_TEXT],
  ["negative", "negative-subtle", AA_TEXT],
  ["warning", "background", AA_TEXT],
  ["warning", "warning-subtle", AA_TEXT],
  ["ring", "background", 3],
];

describe.each([
  ["light", ":root"],
  ["dark", ".dark"],
] as const)("%s theme colour contrast", (_name, selector) => {
  const tokens = readTokens(selector);

  it.each(pairs)("%s on %s ≥ %d:1", (fg, bg, minimum) => {
    expect(tokens[fg], `missing token --${fg}`).toBeDefined();
    expect(tokens[bg], `missing token --${bg}`).toBeDefined();
    const ratio = wcagContrast(tokens[fg]!, tokens[bg]!);
    expect(ratio, `--${fg} on --${bg} is only ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      minimum,
    );
  });
});
