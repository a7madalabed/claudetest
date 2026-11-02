"use client";

import { Check, ChevronsUpDown, Home } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMe } from "@/lib/query/hooks";
import { useCurrentHousehold } from "./household-context";

export function HouseholdSwitcher() {
  const { data: me } = useMe();
  const current = useCurrentHousehold();
  const router = useRouter();
  const pathname = usePathname();

  /** Keep the same section (e.g. /accounts) when switching household. */
  function switchTo(householdId: string) {
    const section = current ? pathname.replace(`/app/${current.id}`, "") : "";
    router.push(`/app/${householdId}${section.startsWith("/settings") ? "" : section}`);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-xl border border-border bg-surface px-2.5 py-2 text-left shadow-elevation-1 transition-colors hover:bg-muted/50 data-[state=open]:bg-muted/50">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary-subtle text-primary">
          <Home className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{current?.name ?? "…"}</span>
          <span className="block text-caption text-muted-foreground capitalize">
            {current?.role}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width)">
        <DropdownMenuLabel>Households</DropdownMenuLabel>
        {me?.households.map((household) => (
          <DropdownMenuItem key={household.id} onSelect={() => switchTo(household.id)}>
            <Home />
            <span className="flex-1 truncate">{household.name}</span>
            {household.role !== "owner" && <Badge className="capitalize">{household.role}</Badge>}
            {household.id === current?.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
