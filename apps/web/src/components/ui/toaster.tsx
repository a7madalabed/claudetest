"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/**
 * Toast notifications via Sonner (the library Vercel and shadcn/ui use):
 * stacked, swipe-to-dismiss, pause-on-hover and announced to screen readers
 * through an ARIA live region. Call `toast("Saved")` from anywhere.
 */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "!rounded-xl !border-border !bg-surface-raised !text-surface-foreground !shadow-elevation-3 !font-sans",
          description: "!text-muted-foreground",
          actionButton: "!bg-primary !text-primary-foreground !rounded-md !font-medium",
        },
      }}
    />
  );
}
