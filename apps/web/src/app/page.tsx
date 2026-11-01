import { Suspense } from "react";
import { formatMoney } from "@ledgerly/shared";
import { ApiStatus, ApiStatusSkeleton } from "@/components/api-status";

// Always render on request so the API status is live, not frozen at build time.
export const dynamic = "force-dynamic";

const stages = [
  "Foundations & architecture",
  "Design system",
  "Database design",
  "Backend API",
  "Authentication & security",
  "Frontend app shell",
  "Transactions",
  "Dashboard & charts",
  "Budgets & goals",
  "Imports & background jobs",
  "Households & real-time",
  "Performance & scalability",
  "Testing strategy",
  "Deployment & operations",
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <header className="animate-rise space-y-4">
        <p className="font-mono text-xs tracking-widest text-emerald-600 uppercase dark:text-emerald-400">
          Stage 1 · Foundations
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Ledgerly</h1>
        <p className="max-w-prose text-lg text-pretty text-zinc-600 dark:text-zinc-400">
          Your money, beautifully organised. The web app, API and shared package are wired together
          — this page is rendered by Next.js and talks to the Fastify API.
        </p>
      </header>

      <section className="animate-rise [animation-delay:120ms]">
        {/* Suspense streams the page instantly and fills in the status when the API answers. */}
        <Suspense fallback={<ApiStatusSkeleton />}>
          <ApiStatus />
        </Suspense>
      </section>

      <section className="animate-rise space-y-3 [animation-delay:240ms]">
        <h2 className="text-sm font-medium text-zinc-500">
          Shared code check —{" "}
          <code className="font-mono">formatMoney(1234567, &quot;USD&quot;)</code>
        </h2>
        <p className="font-mono text-3xl tabular-nums">{formatMoney(1234567, "USD")}</p>
      </section>

      <section className="animate-rise [animation-delay:360ms]">
        <h2 className="mb-3 text-sm font-medium text-zinc-500">Roadmap</h2>
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {stages.map((stage, index) => (
            <li key={stage} className="flex items-baseline gap-3 text-sm">
              <span className="w-5 font-mono text-xs text-zinc-400 tabular-nums">{index + 1}</span>
              <span className={index === 0 ? "font-medium" : "text-zinc-500"}>{stage}</span>
              {index === 0 && <span className="text-emerald-500">●</span>}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
