import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { designPageEnabled } from "@/lib/dev-pages";

// Read at request time: the style-guide link below depends on the server's settings.
export const dynamic = "force-dynamic";

/** Links inside a line of text are always underlined: colour alone can't mark a link. */
const textLink = "font-medium text-primary underline underline-offset-4";

/** What it does: only things the app really does today. */
const points = [
  {
    title: "Every account in one place",
    text: "Checking, savings, cards, loans and cash, each with its own balance.",
  },
  {
    title: "Where the month stands",
    text: "One statement of what came in, what went out, and what you're worth today.",
  },
  {
    title: "Budgets and goals",
    text: "Set a limit for a category and get a warning when you pass it. Save towards something specific.",
  },
  {
    title: "Shared with your household",
    text: "Invite the people you live with. Everyone sees the same figures, as an owner, an editor or a viewer.",
  },
  {
    title: "Yours to take with you",
    text: "Import a bank statement from a CSV file, download all your data, or delete your account whenever you like.",
  },
];

/** The public front door: what Ledgerly is, and how to start. (Stage 19: it used to be a build-progress page.) */
export default function HomePage() {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-6 py-6 sm:px-10">
      <header className="flex items-center justify-between pb-16">
        <Logo />
        <ThemeToggle />
      </header>

      <main className="space-y-14 pb-16">
        <section className="animate-rise space-y-5">
          <h1 className="font-display text-display">Ledgerly</h1>
          <p className="max-w-prose text-lg text-pretty text-muted-foreground">
            The money of a household, kept like a ledger. Add your accounts, record what comes in
            and what goes out, and see where the month stands, together with the people you share a
            home with.
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
          </div>
        </section>

        <section aria-labelledby="what-it-does" className="animate-rise [animation-delay:120ms]">
          <h2 id="what-it-does" className="font-display text-xl font-semibold">
            What it does
          </h2>
          <dl className="mt-3 divide-y divide-border border-y border-border">
            {points.map((point) => (
              <div key={point.title} className="grid gap-1 py-4 sm:grid-cols-[14rem_1fr] sm:gap-6">
                <dt className="font-medium">{point.title}</dt>
                <dd className="text-muted-foreground">{point.text}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-sm text-muted-foreground">
        <Link href="/privacy" className={textLink}>
          Privacy
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className={textLink}>
          Terms
        </Link>
        {designPageEnabled() && (
          <>
            {" "}
            ·{" "}
            <Link href="/design" className={textLink}>
              Design system
            </Link>
          </>
        )}
      </footer>
    </div>
  );
}
