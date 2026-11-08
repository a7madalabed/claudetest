"use client";

/**
 * The right-hand panel on sign-in and sign-up: the COVER of the household's
 * book. Cloth, a gold frame, a ribbon, and a few lines of the first page,
 * written in once as the page loads (a wipe, so text is never half-faded; shown
 * at once if you prefer less motion). Purely visual, so it's hidden from screen readers and from small
 * screens, where it would push the form below the fold.
 *
 * Its colours are fixed rather than themed: a book's cover doesn't change
 * with the light in the room.
 */
const COVER = "#12261f";
const GILT = "#e0bf7a";
const PAPER = "#eef2e3";

const ENTRIES = [
  { label: "Rent, November", amount: "−$1,650.00", out: true },
  { label: "Salary received", amount: "+$4,250.00", out: false },
  { label: "Groceries", amount: "−$86.42", out: true },
];

export function AuthShowcase() {
  return (
    <aside
      aria-hidden
      className="relative hidden items-center justify-center overflow-hidden p-12 lg:flex"
      style={{ background: COVER, color: PAPER }}
    >
      {/* The gilt frame: a thick rule and a thin one, as tooled on a cloth cover. */}
      <div
        className="pointer-events-none absolute inset-8 rounded-[3px] border-2"
        style={{ borderColor: GILT, opacity: 0.85 }}
      />
      <div
        className="pointer-events-none absolute inset-11 rounded-[2px] border"
        style={{ borderColor: GILT, opacity: 0.5 }}
      />
      {/* The ribbon marker, hanging from the top edge. */}
      <svg viewBox="0 0 28 96" className="absolute top-0 right-24 h-24 w-7" aria-hidden>
        <path d="M0 0h28v96l-14-14L0 96z" fill="#b8323f" />
      </svg>

      <div className="relative w-full max-w-md">
        <h2
          className="wipe-in font-display text-5xl leading-[1.08] font-semibold text-balance"
          style={{ color: PAPER, ["--d" as string]: "0.1s" }}
        >
          Keep the household&rsquo;s books together.
        </h2>
        <p
          className="wipe-in mt-5 max-w-sm text-lg"
          style={{ color: GILT, ["--d" as string]: "0.4s" }}
        >
          Every account, budget and goal in one book, kept with the people you share a home with.
        </p>

        {/* A few lines of the first page. */}
        <div className="mt-12 rounded-[3px] px-6 py-2 text-[#14202a]" style={{ background: PAPER }}>
          {ENTRIES.map((entry, i) => (
            <div
              key={entry.label}
              style={{ ["--d" as string]: `${0.7 + i * 0.18}s` }}
              className={`wipe-in flex items-baseline justify-between gap-4 py-3 ${i < ENTRIES.length - 1 ? "border-b border-[#b9c6ad]" : ""}`}
            >
              <span className="font-display text-lg">{entry.label}</span>
              <span
                className="text-lg font-semibold tabular-nums"
                style={{ color: entry.out ? "#a82a3c" : "#1f4e9e" }}
              >
                {entry.amount}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
