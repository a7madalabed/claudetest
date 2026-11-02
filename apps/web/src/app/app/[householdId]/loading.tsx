import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown INSTANTLY while a household page's server work runs (Next.js wraps the
 * page in <Suspense> with this as the fallback). Shaped like the real page, so
 * nothing jumps when content arrives.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10"
      aria-busy="true"
      aria-label="Loading"
    >
      <Skeleton className="mb-3 h-8 w-64" />
      <Skeleton className="mb-10 h-4 w-80" />
      <div className="grid gap-5 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="mt-5 h-72 rounded-2xl" />
    </div>
  );
}
