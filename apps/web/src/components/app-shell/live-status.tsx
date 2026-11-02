"use client";

import { AnimatePresence, motion } from "motion/react";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { spring } from "@/lib/motion";
import { useMembers } from "@/lib/query/household";
import { useMe } from "@/lib/query/hooks";
import { useRealtime } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { useCurrentHousehold } from "./household-context";

/**
 * Who else is here, and is the live connection up? Presence comes from the
 * server (every open tab heartbeats); "Live" means changes made by anyone
 * appear here without a refresh.
 */
export function LiveStatus() {
  const household = useCurrentHousehold();
  const { data: me } = useMe();
  const { status, online } = useRealtime();
  const members = useMembers(household?.id ?? "");
  if (!household) return null;

  // Presence is only known while connected: an outage shouldn't show stale faces.
  const here = (status === "live" ? (online[household.id] ?? []) : [])
    .filter((id) => id !== me?.id)
    .map((id) => members.data?.find((m) => m.userId === id))
    .filter((m) => m !== undefined);

  return (
    <div className="flex items-center justify-between px-1.5 text-caption text-muted-foreground">
      <span className="flex items-center gap-1.5" role="status" aria-live="polite">
        <span className="relative flex size-2">
          {status === "live" && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60" />
          )}
          <span
            className={cn(
              "relative inline-flex size-2 rounded-full",
              status === "live" ? "bg-positive" : "bg-warning",
            )}
          />
        </span>
        {status === "live" ? "Live" : status === "reconnecting" ? "Reconnecting…" : "Connecting…"}
      </span>
      <ul className="flex -space-x-1.5" aria-label="Also here now">
        <AnimatePresence initial={false}>
          {here.map((member) => (
            <motion.li
              key={member.userId}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={spring.bouncy}
            >
              <Tooltip content={`${member.displayName} is here`}>
                <span
                  tabIndex={0}
                  className="block rounded-full ring-2 ring-background outline-none"
                >
                  <Avatar name={member.displayName} className="size-6 text-[10px]" />
                  <span className="sr-only">{member.displayName} is here</span>
                </span>
              </Tooltip>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}
