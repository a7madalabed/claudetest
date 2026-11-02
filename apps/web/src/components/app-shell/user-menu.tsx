"use client";

import { LogOut, Monitor, Moon, Palette, Shield, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLogout, useMe } from "@/lib/query/hooks";

export function useSignOut() {
  const logout = useLogout();
  return () => logout.mutate();
}

export function UserMenu() {
  const { data: me } = useMe();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const signOut = useSignOut();
  if (!me) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted/60 data-[state=open]:bg-muted/60">
        <Avatar name={me.displayName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{me.displayName}</span>
          <span className="block truncate text-caption text-muted-foreground">{me.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel>{me.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => router.push("/app/settings/security")}>
          <Shield /> Security settings
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette /> Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
              <DropdownMenuRadioItem value="system">
                <Monitor /> System
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="light">
                <Sun /> Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="dark">
                <Moon /> Dark
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={signOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
