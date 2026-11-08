"use client";

import type { ReactNode } from "react";
import { AnimatedMoney, Amount } from "@/components/money";
import { formatMonthYear, localMonth } from "@/lib/budgets";
import { relativeChange } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

/**
 * "Where does the month stand?", written the way a bookkeeper would: what was
 * brought forward, what came in, what went out, and what's in hand today, with
 * a single rule above the total and a double rule under it. (Stage 18.)
 *
 * Everything on the page is arithmetic you can check with a pencil:
 *   brought forward + received − spent = in hand.
 * If something else changed the total (an account added mid-month, say) it gets
 * its own line, so the sum always adds up.
 */
export function MonthStatement({
  now,
  currency,
  receivedMinor,
  spentMinor,
  inHandMinor,
  broughtForwardMinor,
  previousSpentMinor,
  savingsRate,
  savingsGoal = 0.2,
}: {
  /** The household's wall clock (see householdNow). */
  now: Date;
  currency: string;
  receivedMinor: number | undefined;
  spentMinor: number | undefined;
  inHandMinor: number | undefined;
  /** The balance at the end of last month, when known. */
  broughtForwardMinor: number | undefined;
  /** Spending over the same days of last month, to compare with. */
  previousSpentMinor: number | undefined;
  /** (income − spending) / income; null when nothing has come in yet. */
  savingsRate: number | null | undefined;
  savingsGoal?: number;
}) {
  const day = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const previousMonth = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1)),
  );

  const known =
    receivedMinor !== undefined && spentMinor !== undefined && inHandMinor !== undefined;
  // If last month's closing balance is known, use it, and show any difference as
  // its own line. If not (a brand-new household), work it back from today.
  const broughtForward = !known
    ? undefined
    : (broughtForwardMinor ?? inHandMinor - receivedMinor + spentMinor);
  const other =
    !known || broughtForward === undefined
      ? 0
      : inHandMinor - broughtForward - receivedMinor + spentMinor;

  const spentChange =
    spentMinor !== undefined && previousSpentMinor !== undefined
      ? relativeChange(spentMinor, previousSpentMinor)
      : null;
  const spentNote =
    spentChange === null
      ? undefined
      : Math.abs(Math.round(spentChange * 100)) === 0
        ? `About the same as the same days of ${previousMonth}`
        : `${Math.abs(Math.round(spentChange * 100))}% ${spentChange < 0 ? "less" : "more"} than the same days of ${previousMonth}`;

  return (
    <div className="relative rounded-2xl border border-border bg-surface py-5 pr-5 pl-9 sm:py-7 sm:pr-8 sm:pl-14">
      {/* The red margin: two thin lines, as ruled into the page. */}
      <span aria-hidden className="absolute inset-y-0 left-5 w-px bg-negative/55 sm:left-8" />
      <span
        aria-hidden
        className="absolute inset-y-0 left-[1.625rem] w-px bg-negative/55 sm:left-[2.375rem]"
      />

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-3">
        <h2 id="this-month" className="font-display text-headline">
          {formatMonthYear(localMonth(now))}
        </h2>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            Day {day} of {daysInMonth}
          </span>
          <TallyStrip day={day} days={daysInMonth} />
        </div>
      </header>
      <div aria-hidden className="rule-in h-px bg-foreground/70" style={delay(0.1)} />

      <dl>
        <Line
          at={0.25}
          label="Brought forward"
          note={`from the end of ${previousMonth}`}
          value={
            known && broughtForward !== undefined ? (
              <Plain value={broughtForward} currency={currency} />
            ) : undefined
          }
        />
        <Line
          at={0.4}
          label="Received"
          value={
            receivedMinor === undefined ? undefined : (
              <Amount value={receivedMinor} currency={currency} className="text-xl font-semibold" />
            )
          }
        />
        <Line
          at={0.55}
          label="Spent"
          note={spentNote}
          value={
            spentMinor === undefined ? undefined : (
              <Amount value={-spentMinor} currency={currency} className="text-xl font-semibold" />
            )
          }
        />
        {known && Math.abs(other) >= 1 && (
          <Line
            at={0.65}
            label="Accounts added or adjusted"
            value={<Amount value={other} currency={currency} className="text-xl font-semibold" />}
          />
        )}

        {/* The sum: a single rule above, a double rule below. */}
        <div
          className="wipe-in mt-1 flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-t border-foreground/70 pt-3 pb-3 [border-bottom:5px_double_color-mix(in_oklch,var(--foreground)_70%,transparent)]"
          style={delay(0.75)}
        >
          <dt className="font-display text-xl font-semibold">In hand today</dt>
          <dd className="font-display text-4xl font-semibold sm:text-5xl">
            {inHandMinor === undefined ? (
              <span className="block h-12 w-56 animate-pulse rounded-sm bg-muted" />
            ) : (
              <AnimatedMoney value={inHandMinor} currency={currency} />
            )}
          </dd>
        </div>
      </dl>

      <Stamp rate={savingsRate} goal={savingsGoal} />
    </div>
  );
}

/** CSS custom property that sets when an element's reveal starts (see globals.css). */
const delay = (seconds: number) => ({ ["--d" as string]: `${seconds}s` });

function Plain({ value, currency }: { value: number; currency: string }) {
  return <AnimatedMoney value={value} currency={currency} className="text-xl font-semibold" />;
}

/** One line of the statement: a label (with an optional quiet note), and the figure. */
function Line({
  label,
  note,
  value,
  at,
}: {
  label: string;
  note?: string;
  value: ReactNode | undefined;
  /** When this line is written in, in seconds after the page loads. */
  at: number;
}) {
  return (
    <div
      className="wipe-in flex items-baseline justify-between gap-4 border-b border-border py-3"
      style={delay(at)}
    >
      <dt>
        <span className="text-base">{label}</span>
        {note && <span className="block text-sm text-muted-foreground">{note}</span>}
      </dt>
      <dd className="shrink-0 text-right">
        {value ?? <span className="block h-6 w-28 animate-pulse rounded-sm bg-muted" />}
      </dd>
    </div>
  );
}

/**
 * The days of the month as a tally: four strokes and a diagonal across them
 * make five days. Days gone are inked; days to come are faint.
 */
function TallyStrip({ day, days }: { day: number; days: number }) {
  const GROUP = 26; // px per group of five
  const groups = Math.ceil(days / 5);
  const marks = Array.from({ length: days }, (_, index) => {
    const d = index + 1;
    const group = Math.floor(index / 5);
    const slot = index % 5;
    const x0 = group * GROUP;
    return slot < 4
      ? { d, x1: x0 + slot * 5 + 2, y1: 3, x2: x0 + slot * 5 + 2, y2: 19 }
      : { d, x1: x0 - 1, y1: 17, x2: x0 + 19, y2: 5 };
  });
  return (
    <svg
      role="img"
      aria-label={`${day} days gone, ${days - day} to come`}
      viewBox={`0 0 ${groups * GROUP} 22`}
      width={groups * GROUP}
      height={22}
      className="overflow-visible"
    >
      {marks.map((m) => (
        <line
          key={m.d}
          x1={m.x1}
          y1={m.y1}
          x2={m.x2}
          y2={m.y2}
          strokeWidth={m.d === day ? 2.4 : 1.8}
          strokeLinecap="round"
          className={cn(
            "tally-mark",
            m.d <= day ? "stroke-foreground" : "stroke-[var(--chart-axis)]",
          )}
          style={{ ["--i" as string]: m.d }}
        />
      ))}
    </svg>
  );
}

/** The rubber stamp: one verdict, in violet ink, set a little crooked. */
function Stamp({ rate, goal }: { rate: number | null | undefined; goal: number }) {
  if (rate === undefined || rate === null) return null;
  const kept = Math.round(rate * 100);
  const verdict =
    rate >= goal ? "On target" : rate >= 0 ? "Below target" : "Spent more than came in";
  return (
    <div
      className="stamp-in mt-6 inline-block origin-left rounded-md border-[3px] border-double border-stamp px-4 py-2 text-stamp"
      style={{ ...delay(1.05), transform: "rotate(-2deg)" }}
    >
      <p className="font-display text-xl leading-tight font-bold">{verdict}</p>
      <p className="text-sm font-semibold">
        {rate < 0
          ? `The goal is to keep ${Math.round(goal * 100)}%`
          : `Kept ${kept}% of income, goal ${Math.round(goal * 100)}%`}
      </p>
    </div>
  );
}
