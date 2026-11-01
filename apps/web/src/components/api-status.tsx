import { Skeleton } from "@/components/ui/skeleton";
import { getApiHealth } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A React *Server Component*: it runs on the server, awaits data directly, and
 * sends finished HTML to the browser — zero JavaScript shipped for it.
 */
export async function ApiStatus() {
  const health = await getApiHealth();

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-elevation-1"
    >
      <span className="relative flex size-2.5">
        {health.ok && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2.5 rounded-full",
            health.ok ? "bg-positive" : "bg-negative",
          )}
        />
      </span>
      {health.ok ? (
        <span>
          API online ·{" "}
          <span className="font-mono text-muted-foreground">v{health.data.version}</span> · up{" "}
          {health.data.uptimeSeconds}s
        </span>
      ) : (
        <span className="text-negative">{health.error}</span>
      )}
    </div>
  );
}

export function ApiStatusSkeleton() {
  return <Skeleton className="h-[46px] w-64 rounded-2xl" />;
}
