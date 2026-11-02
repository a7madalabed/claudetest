"use client";

import type { NotificationDto } from "@ledgerly/shared";
import {
  Bell,
  CircleAlert,
  FileCheck,
  FileX,
  Repeat,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { spring } from "@/lib/motion";
import { useMarkNotificationsRead, useNotifications } from "@/lib/query/automation";
import { cn } from "@/lib/utils";

const kindIcon: Record<string, { icon: LucideIcon; tone: string }> = {
  "budget.over": { icon: CircleAlert, tone: "text-negative bg-negative-subtle" },
  "budget.warning": { icon: TriangleAlert, tone: "text-warning bg-warning-subtle" },
  "import.completed": { icon: FileCheck, tone: "text-positive bg-positive-subtle" },
  "import.failed": { icon: FileX, tone: "text-negative bg-negative-subtle" },
};
const fallback = { icon: Repeat, tone: "text-primary bg-primary-subtle" };

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function NotificationBell({ className }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = data?.unreadCount ?? 0;

  function openNotification(n: NotificationDto) {
    if (!n.readAt) markRead.mutate([n.id]);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
          className={cn(
            "relative flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            className,
          )}
        >
          <Bell className="size-4.5" />
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                key={unread}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={spring.bouncy}
                className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-semibold text-white tabular-nums ring-2 ring-background dark:text-black"
              >
                {unread > 9 ? "9+" : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => markRead.mutate(undefined)}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all as read
            </button>
          )}
        </div>
        {!data?.data.length ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing yet. Budget alerts and finished imports show up here.
          </p>
        ) : (
          <ul className="max-h-[min(26rem,60vh)] overflow-y-auto p-1">
            {data.data.map((n) => {
              const { icon: Icon, tone } = kindIcon[n.kind] ?? fallback;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(n)}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted"
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                        tone,
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !n.readAt && "font-semibold")}>
                        {n.title}
                      </span>
                      <span className="block text-caption text-muted-foreground">{n.body}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
                        {timeAgo(n.createdAt)}
                      </span>
                    </span>
                    {!n.readAt && (
                      <span
                        className="mt-2 size-2 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
