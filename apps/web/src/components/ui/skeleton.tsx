import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A placeholder shaped like the content that's loading, with a soft shimmer. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-muted bg-[length:200%_100%]",
        "bg-[linear-gradient(90deg,transparent_0%,color-mix(in_oklch,var(--foreground)_6%,transparent)_50%,transparent_100%)]",
        className,
      )}
      {...props}
    />
  );
}
