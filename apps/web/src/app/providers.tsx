"use client";

import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * App-wide client providers, kept in one small file so the root layout can stay
 * a Server Component.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    // Adds class="dark" to <html> before first paint (via a tiny inline script),
    // so there's no "flash" of the wrong theme on load.
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {/* Every Motion animation automatically respects the OS "reduce motion" setting. */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster />
        </TooltipProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
