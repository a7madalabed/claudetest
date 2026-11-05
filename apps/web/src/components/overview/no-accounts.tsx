"use client";

import { Plus, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Shown wherever an account is needed but the household has none yet
 * (Stage 16: a new household used to hit a dead end here). It always says
 * what to do next, and — for people who may — offers to do it.
 */
export function NoAccountsNotice({
  householdId,
  canEdit,
  title = "Add your first account",
  children = "Transactions, imports and goals all belong to an account: a bank account, card, wallet or loan.",
  className,
}: {
  householdId: string;
  canEdit: boolean;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn("grid place-items-center gap-3 px-6 py-12 text-center", className)}
      role="status"
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
        <Wallet className="size-6" />
      </span>
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-pretty text-muted-foreground">{children}</p>
      {canEdit ? (
        <Button asChild>
          <Link href={`/app/${householdId}/accounts?new=1`}>
            <Plus /> Add an account
          </Link>
        </Button>
      ) : (
        <p className="text-caption text-muted-foreground">
          Ask an owner or editor of this household to add one.
        </p>
      )}
    </Card>
  );
}
