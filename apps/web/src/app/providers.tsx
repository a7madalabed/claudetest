"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createQueryClient } from "@/lib/query/client";

/**
 * App-wide client providers, kept in one small file so the root layout can stay
 * a Server Component.
 */
export function Providers({ children }: { children: ReactNode }) {
  // useState (not a module-level constant) so each browser tab — and each server
  // render — gets its own cache. A shared module-level client on the server
  // could leak one user's data into another user's page.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Adds class="dark" to <html> before first paint, so there's no theme flash. */}
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        {/* Every Motion animation automatically respects the OS "reduce motion" setting. */}
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={300}>
            {children}
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="top-right" />
    </QueryClientProvider>
  );
}
