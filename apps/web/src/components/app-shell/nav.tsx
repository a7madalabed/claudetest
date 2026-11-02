"use client";

import {
  ArrowLeftRight,
  Goal,
  LayoutDashboard,
  ChartPie,
  FileUp,
  Shield,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match only the exact path (for the household root). */
  exact?: boolean;
  /** A count that needs attention (e.g. budgets over their limit). */
  badge?: { count: number; label: string };
}

export function householdNav(householdId: string, overBudget = 0): NavItem[] {
  return [
    { href: `/app/${householdId}`, label: "Dashboard", icon: LayoutDashboard, exact: true },
    { href: `/app/${householdId}/transactions`, label: "Transactions", icon: ArrowLeftRight },
    {
      href: `/app/${householdId}/budgets`,
      label: "Budgets",
      icon: ChartPie,
      ...(overBudget > 0 && {
        badge: {
          count: overBudget,
          label: `${overBudget} ${overBudget === 1 ? "budget" : "budgets"} over the limit`,
        },
      }),
    },
    { href: `/app/${householdId}/goals`, label: "Goals", icon: Goal },
    { href: `/app/${householdId}/accounts`, label: "Accounts", icon: Wallet },
    { href: `/app/${householdId}/imports`, label: "Imports", icon: FileUp },
  ];
}

export const settingsNav: NavItem[] = [
  { href: "/app/settings/security", label: "Security", icon: Shield },
];

/**
 * Navigation links with a highlight that GLIDES to the active item (a shared
 * layout animation, like the theme toggle in Stage 2). `aria-current="page"`
 * tells screen readers which page is active — colour alone wouldn't.
 */
export function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <ul className="grid gap-0.5">
      {items.map(({ href, label, icon: Icon, exact, badge }) => {
        const active = exact
          ? pathname === href
          : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <li key={href}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-active"
                  transition={spring.snappy}
                  className="absolute inset-0 rounded-lg bg-surface shadow-elevation-1 ring-1 ring-border"
                />
              )}
              <Icon className={cn("relative size-4", active && "text-primary")} />
              <span className="relative">{label}</span>
              {badge && (
                <motion.span
                  key={badge.count}
                  initial={{ scale: 0.5, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={spring.bouncy}
                  title={badge.label}
                  className="relative ml-auto rounded-full bg-negative-subtle px-1.5 text-xs font-semibold text-negative tabular-nums"
                >
                  {badge.count}
                  <span className="sr-only"> — {badge.label}</span>
                </motion.span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
