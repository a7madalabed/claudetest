import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { ButtonsDemo } from "./_components/buttons-demo";
import { ColorSwatches } from "./_components/color-swatches";
import { FeedbackDemo } from "./_components/feedback-demo";
import { FormsDemo } from "./_components/forms-demo";
import { LedgerDemo } from "./_components/ledger-demo";
import { Section } from "./_components/section";

export const metadata: Metadata = {
  title: "Design system",
  description: "Ledgerly's design tokens, components and motion — all in one living style guide.",
};

const sections = [
  ["motion", "Motion"],
  ["colour", "Colour"],
  ["typography", "Typography"],
  ["buttons", "Buttons"],
  ["forms", "Forms"],
  ["feedback", "Feedback"],
  ["elevation", "Elevation"],
] as const;

export default function DesignSystemPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 pb-32 sm:px-8">
      <header className="sticky top-0 z-40 -mx-5 flex items-center justify-between gap-4 border-b border-border bg-background/80 px-5 py-3 backdrop-blur-md sm:-mx-8 sm:px-8">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <ArrowLeft /> Home
          </Link>
        </Button>
        <nav aria-label="Sections" className="hidden gap-1 md:flex">
          {sections.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <ThemeToggle />
      </header>

      <div className="animate-rise space-y-3 pt-16 pb-12">
        <p className="font-mono text-caption tracking-widest text-primary uppercase">
          Stage 2 · Design system
        </p>
        <h1 className="text-display text-balance">The building blocks of Ledgerly</h1>
        <p className="max-w-2xl text-lg text-pretty text-muted-foreground">
          Every colour, size and animation in the app comes from the tokens and components on this
          page. It&apos;s a living style guide: it renders the real components, so it can never go
          out of date.
        </p>
      </div>

      <div className="space-y-24">
        <Section
          id="motion"
          title="Motion"
          description="Springs for things that move, short ease-out curves for things that appear. Try adding and removing transactions — every change animates, and nothing jumps."
        >
          <LedgerDemo />
        </Section>

        <Section
          id="colour"
          title="Colour"
          description="Semantic tokens describe what a colour is for, not what it looks like. Every text pair is contrast-tested (WCAG AA) in both themes by an automated test."
        >
          <ColorSwatches />
        </Section>

        <Section
          id="typography"
          title="Typography"
          description="Geist Sans for UI, Geist Mono for code. Large text is tracked tighter, numbers use tabular figures so columns align."
        >
          <div className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-elevation-1">
            {[
              ["text-display", "Display", "Net worth"],
              ["text-headline", "Headline", "March overview"],
              ["text-title", "Title", "Recent transactions"],
              ["text-base", "Body", "You spent 12% less on dining out than last month."],
              ["text-sm text-muted-foreground", "Small / muted", "Updated 2 minutes ago"],
              ["text-caption text-muted-foreground", "Caption", "AMOUNTS IN USD"],
            ].map(([className, name, sample]) => (
              <div key={name} className="flex items-baseline gap-6 px-5 py-4">
                <span className="w-28 shrink-0 font-mono text-caption text-muted-foreground">
                  {name}
                </span>
                <span className={`${className} truncate`}>{sample}</span>
              </div>
            ))}
            <div className="grid gap-6 px-5 py-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 font-mono text-caption text-muted-foreground">
                  proportional figures ✗
                </p>
                <p className="text-xl [font-variant-numeric:proportional-nums]">
                  $1,111.11
                  <br />
                  $8,888.88
                </p>
              </div>
              <div>
                <p className="mb-2 font-mono text-caption text-muted-foreground">
                  tabular figures ✓
                </p>
                <p className="text-xl tabular-nums">
                  $1,111.11
                  <br />
                  $8,888.88
                </p>
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="buttons"
          title="Buttons"
          description="One component, typed variants. Press feedback, a loading state that never changes the button's width, and a visible focus ring for keyboard users (press Tab)."
        >
          <ButtonsDemo />
        </Section>

        <Section
          id="forms"
          title="Forms"
          description="Labels, hints and errors are wired up automatically for screen readers. Money input is parsed from the string — never through a float."
        >
          <FormsDemo />
        </Section>

        <Section
          id="feedback"
          title="Feedback"
          description="Badges for status, skeletons for loading, toasts for confirmations, tooltips for hints."
        >
          <FeedbackDemo />
        </Section>

        <Section
          id="elevation"
          title="Elevation"
          description="Three levels of depth. In light mode it comes from soft shadows; in dark mode from lighter surfaces and a faint top highlight."
        >
          <div className="grid gap-5 sm:grid-cols-3">
            {(
              [
                ["shadow-elevation-1 bg-surface", "Level 1", "Cards, inputs"],
                ["shadow-elevation-2 bg-surface", "Level 2", "Hovered cards, menus"],
                ["shadow-elevation-3 bg-surface-raised", "Level 3", "Dialogs, toasts"],
              ] as const
            ).map(([className, name, usage]) => (
              <div
                key={name}
                className={`flex h-32 flex-col justify-end rounded-2xl border border-border p-5 ${className}`}
              >
                <p className="font-medium">{name}</p>
                <p className="text-sm text-muted-foreground">{usage}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
