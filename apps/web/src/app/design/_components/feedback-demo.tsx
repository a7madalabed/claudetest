"use client";

import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Check } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";

export function FeedbackDemo() {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Badges</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Badge>Pending</Badge>
          <Badge tone="primary">Recurring</Badge>
          <Badge tone="positive">
            <ArrowDownLeft /> Income
          </Badge>
          <Badge tone="negative">
            <ArrowUpRight /> Expense
          </Badge>
          <Badge tone="warning">
            <AlertTriangle /> 90% of budget
          </Badge>
          <Badge tone="positive">
            <Check /> Reconciled
          </Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Toasts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.success("Import complete", { description: "142 transactions added" })
            }
          >
            Success
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.error("Couldn't connect", { description: "Check your connection and retry." })
            }
          >
            Error
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.promise(new Promise((resolve) => setTimeout(resolve, 1800)), {
                loading: "Syncing accounts…",
                success: "Accounts up to date",
                error: "Sync failed",
              })
            }
          >
            Promise
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Skeleton</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="size-9 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-2.5 w-1/4" />
              </div>
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Keyboard hints</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {[
            [["⌘", "K"], "Command palette (Stage 6)"],
            [["N"], "New transaction"],
            [["/"], "Search"],
            [["Esc"], "Close dialog"],
          ].map(([keys, label]) => (
            <div key={String(label)} className="flex items-center justify-between">
              <span className="text-muted-foreground">{label}</span>
              <span className="flex gap-1">
                {(keys as string[]).map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
