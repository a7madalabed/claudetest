import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know our CUSTOM type scale (globals.css: --text-display,
 * --text-headline, --text-title, --text-caption). Without this it can't tell
 * that `text-display` is a font SIZE and treats it as a text COLOUR — so
 * cn("text-display", "text-negative") silently dropped the size. (Found in
 * Stage 9; there's a test for it now.)
 */
const twMerge = extendTailwindMerge({
  extend: { theme: { text: ["display", "headline", "title", "caption"] } },
});

/**
 * Combines class names and resolves Tailwind conflicts, so callers can override
 * a component's defaults: cn("px-4", "px-6") → "px-6" (not "px-4 px-6").
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
