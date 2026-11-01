"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { motion } from "motion/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const options = [
  { value: "system", label: "System theme", icon: Monitor },
  { value: "light", label: "Light theme", icon: Sun },
  { value: "dark", label: "Dark theme", icon: Moon },
] as const;

// True only after hydration. The server can't know the user's theme, so we avoid
// rendering a selection that might not match what the browser shows.
const useIsClient = () =>
  useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

/**
 * A segmented control. The highlighted "pill" glides between options using a
 * Motion *shared layout animation* (`layoutId`): Motion measures where the pill
 * was and where it is now, and springs between the two.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const isClient = useIsClient();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-muted p-0.5",
        className,
      )}
    >
      {options.map(({ value, label, icon: Icon }) => {
        const selected = isClient && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "relative flex size-7 items-center justify-center rounded-full transition-colors",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {selected && (
              <motion.span
                layoutId="theme-toggle-pill"
                transition={spring.snappy}
                className="absolute inset-0 rounded-full bg-surface shadow-elevation-1"
              />
            )}
            <Icon className="relative size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
