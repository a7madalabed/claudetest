import { getApiHealth } from "@/lib/api";

/**
 * A React *Server Component*: it runs on the server, awaits data directly, and
 * sends finished HTML to the browser — zero JavaScript shipped for it.
 */
export async function ApiStatus() {
  const health = await getApiHealth();

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white/70 px-4 py-3 text-sm shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70"
    >
      <span className="relative flex size-2.5">
        {health.ok && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={`relative inline-flex size-2.5 rounded-full ${health.ok ? "bg-emerald-500" : "bg-rose-500"}`}
        />
      </span>
      {health.ok ? (
        <span>
          API online · <span className="font-mono text-zinc-500">v{health.data.version}</span> · up{" "}
          {health.data.uptimeSeconds}s
        </span>
      ) : (
        <span className="text-rose-600 dark:text-rose-400">{health.error}</span>
      )}
    </div>
  );
}

export function ApiStatusSkeleton() {
  return (
    <div
      aria-hidden
      className="h-[46px] w-64 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
    />
  );
}
