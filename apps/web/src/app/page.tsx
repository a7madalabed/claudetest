import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Check } from "lucide-react";
import { formatMoney } from "@ledgerly/shared";
import { ApiStatus, ApiStatusSkeleton } from "@/components/api-status";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Always render on request so the API status is live, not frozen at build time.
export const dynamic = "force-dynamic";

const CURRENT_STAGE = 10;

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
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <header className="animate-rise space-y-4">
        <p className="font-mono text-caption tracking-widest text-primary uppercase">
          Stage {CURRENT_STAGE} · Imports & background jobs
        </p>
        <h1 className="text-display">Ledgerly</h1>
        <p className="max-w-prose text-lg text-pretty text-muted-foreground">
          Your money, beautifully organised. The web app, API and shared package are wired together,
          and every pixel now comes from a tested design system.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild size="lg">
            <Link href="/signup">
              Get started <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="/design">Design system</Link>
          </Button>
        </div>
      </header>

      <section className="animate-rise [animation-delay:120ms]">
        {/* Suspense streams the page instantly and fills in the status when the API answers. */}
        <Suspense fallback={<ApiStatusSkeleton />}>
          <ApiStatus />
        </Suspense>
      </section>

      <section className="animate-rise space-y-3 [animation-delay:240ms]">
        <h2 className="text-sm font-medium text-muted-foreground">
          Shared code check —{" "}
          <code className="font-mono">formatMoney(1234567, &quot;USD&quot;)</code>
        </h2>
        <p className="font-mono text-3xl tabular-nums">{formatMoney(1234567, "USD")}</p>
      </section>

      <section className="animate-rise [animation-delay:360ms]">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Roadmap</h2>
        <ol className="grid gap-1.5 sm:grid-cols-2">
          {stages.map((stage, index) => {
            const number = index + 1;
            const done = number < CURRENT_STAGE;
            const current = number === CURRENT_STAGE;
            return (
              <li key={stage} className="flex items-center gap-3 text-sm">
                <span className="w-5 font-mono text-xs text-muted-foreground tabular-nums">
                  {number}
                </span>
                <span
                  className={cn(
                    current && "font-medium",
                    done && "text-foreground",
                    !done && !current && "text-muted-foreground",
                  )}
                >
                  {stage}
                </span>
                {done && <Check aria-label="done" className="size-3.5 text-positive" />}
                {current && (
                  <span aria-label="in progress" className="size-2 rounded-full bg-primary" />
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
