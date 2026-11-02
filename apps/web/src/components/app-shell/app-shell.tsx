"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/logo";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useNotificationToasts, useOverBudgetCount } from "@/lib/use-alerts";
import { CommandPalette } from "./command-palette";
import { useCurrentHousehold } from "./household-context";
import { HouseholdSwitcher } from "./household-switcher";
import { NavList, householdNav, settingsNav } from "./nav";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";

function SidebarContents({
  onNavigate,
  onOpenPalette,
  overBudget,
}: {
  onNavigate?: () => void;
  onOpenPalette: () => void;
  overBudget: number;
}) {
  const household = useCurrentHousehold();
  return (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="flex items-center justify-between pl-1.5 pt-1">
        <Link href={household ? `/app/${household.id}` : "/app"} onClick={onNavigate}>
          <Logo />
        </Link>
        {/* The mobile menu has its own bell in the top bar. */}
        {!onNavigate && <NotificationBell />}
      </div>
      <HouseholdSwitcher />
      <button
        type="button"
        onClick={onOpenPalette}
        className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted-foreground shadow-elevation-1 transition-colors hover:text-foreground"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>⌘K</Kbd>
      </button>
      <nav aria-label="Main" className="grid gap-6">
        {household && (
          <NavList items={householdNav(household.id, overBudget)} onNavigate={onNavigate} />
        )}
        <div className="grid gap-1.5">
          <p className="px-3 text-caption font-medium tracking-wide text-muted-foreground uppercase">
            Settings
          </p>
          <NavList items={settingsNav} onNavigate={onNavigate} />
        </div>
      </nav>
      <div className="mt-auto">
        <UserMenu />
      </div>
    </div>
  );
}

/**
 * The authenticated app's frame: a fixed sidebar on large screens; a top bar
 * with a slide-in menu on small ones. Both render the SAME sidebar contents, so
 * navigation can never differ between mobile and desktop.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Called ONCE here (not in the sidebar, which renders twice: desktop + mobile menu).
  const household = useCurrentHousehold();
  const overBudget = useOverBudgetCount(household?.id);
  useNotificationToasts();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-muted/40 lg:block">
        <SidebarContents overBudget={overBudget} onOpenPalette={() => setPaletteOpen(true)} />
      </aside>

      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur-md lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent aria-describedby={undefined}>
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SidebarContents
              overBudget={overBudget}
              onNavigate={() => setMobileOpen(false)}
              onOpenPalette={() => {
                setMobileOpen(false);
                setPaletteOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
        <Logo />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Search"
          >
            <Search className="size-5" />
          </button>
        </div>
      </header>

      <main id="main" className="min-w-0">
        {children}
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
