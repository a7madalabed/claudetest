import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines class names and resolves Tailwind conflicts, so callers can override
 * a component's defaults: cn("px-4", "px-6") → "px-6" (not "px-4 px-6").
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
