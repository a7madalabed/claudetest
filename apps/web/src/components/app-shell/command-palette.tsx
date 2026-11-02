"use client";

import { Command } from "cmdk";
import {
  FileUp,
  Goal,
  Home,
  LogOut,
  Monitor,
  Moon,
  PiggyBank,
  Plus,
  Search,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, type ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { useMe } from "@/lib/query/hooks";
import { useCurrentHousehold } from "./household-context";
import { householdNav, settingsNav } from "./nav";
import { useSignOut } from "./user-menu";

/**
 * ⌘K / Ctrl+K command palette (cmdk — the library behind Linear's and Vercel's).
 * Power users navigate without the mouse; everyone gets fuzzy search over every
 * action. Built on a Radix Dialog, so focus trapping and Esc work as usual.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const { data: me } = useMe();
  const household = useCurrentHousehold();
  const signOut = useSignOut();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const run = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-[15vh] left-1/2 z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-elevation-3 data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command
            loop
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-caption [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                autoFocus
                placeholder="Type a command or search…"
                className="h-13 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
              />
              <Kbd>Esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain p-1.5 pb-2">
              <Command.Empty className="py-10 text-center text-sm text-muted-foreground">
                No results.
              </Command.Empty>

              {household && (
                <Command.Group heading="Actions">
                  <PaletteItem
                    icon={Plus}
                    keywords={["add", "expense", "income", "record"]}
                    onSelect={run(() => router.push(`/app/${household.id}/transactions?new=1`))}
                  >
                    New transaction
                  </PaletteItem>
                  <PaletteItem
                    icon={PiggyBank}
                    keywords={["budget", "limit", "category"]}
                    onSelect={run(() => router.push(`/app/${household.id}/budgets?new=1`))}
                  >
                    New budget
                  </PaletteItem>
                  <PaletteItem
                    icon={Goal}
                    keywords={["goal", "save", "savings", "target"]}
                    onSelect={run(() => router.push(`/app/${household.id}/goals?new=1`))}
                  >
                    New savings goal
                  </PaletteItem>
                  <PaletteItem
                    icon={FileUp}
                    keywords={["import", "csv", "bank", "upload", "statement"]}
                    onSelect={run(() => router.push(`/app/${household.id}/imports`))}
                  >
                    Import a bank file
                  </PaletteItem>
                </Command.Group>
              )}

              {household && (
                <Command.Group heading="Go to">
                  {[...householdNav(household.id), ...settingsNav(household.id)].map((item) => (
                    <PaletteItem
                      key={item.href}
                      icon={item.icon}
                      onSelect={run(() => router.push(item.href))}
                    >
                      {item.label}
                    </PaletteItem>
                  ))}
                </Command.Group>
              )}

              {me && me.households.length > 1 && (
                <Command.Group heading="Switch household">
                  {me.households.map((h) => (
                    <PaletteItem
                      key={h.id}
                      icon={Home}
                      keywords={["household", "switch"]}
                      onSelect={run(() => router.push(`/app/${h.id}`))}
                    >
                      {h.name}
                    </PaletteItem>
                  ))}
                </Command.Group>
              )}

              <Command.Group heading="Theme">
                <PaletteItem
                  icon={Sun}
                  keywords={["appearance"]}
                  onSelect={run(() => setTheme("light"))}
                >
                  Light theme
                </PaletteItem>
                <PaletteItem
                  icon={Moon}
                  keywords={["appearance"]}
                  onSelect={run(() => setTheme("dark"))}
                >
                  Dark theme
                </PaletteItem>
                <PaletteItem
                  icon={Monitor}
                  keywords={["appearance"]}
                  onSelect={run(() => setTheme("system"))}
                >
                  System theme
                </PaletteItem>
              </Command.Group>

              <Command.Group heading="Account">
                <PaletteItem icon={LogOut} keywords={["logout", "log out"]} onSelect={run(signOut)}>
                  Sign out
                </PaletteItem>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function PaletteItem({
  icon: Icon,
  children,
  onSelect,
  keywords,
}: {
  icon: LucideIcon;
  children: ReactNode;
  onSelect: () => void;
  keywords?: string[];
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      keywords={keywords}
      className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 text-sm select-none data-[selected=true]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground"
    >
      <Icon />
      {children}
    </Command.Item>
  );
}
