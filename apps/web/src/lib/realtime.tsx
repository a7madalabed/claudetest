"use client";

import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { MemberDto, MeDto } from "@ledgerly/shared";
import { useMe } from "./query/hooks";

export type RealtimeStatus = "connecting" | "live" | "reconnecting";

interface LiveEvent {
  type: string;
  householdId?: string;
  op?: string;
  count?: number;
  actors?: string[];
  users?: string[];
  userId?: string;
  online?: boolean;
}

interface RealtimeState {
  status: RealtimeStatus;
  /** householdId → user ids online right now (other tabs/people, from the server). */
  online: Record<string, string[]>;
}

const RealtimeContext = createContext<RealtimeState>({ status: "connecting", online: {} });

export const useRealtime = () => useContext(RealtimeContext);
/** True while pushes are flowing — hooks use it to switch polling off. */
export const useIsLive = () => useContext(RealtimeContext).status === "live";

const h = (id: string, ...rest: string[]): QueryKey => ["households", id, ...rest];

/**
 * Which cached queries does an event make stale? Events say WHAT changed, never
 * the new data: we refetch what's on screen. That keeps the stream tiny, keeps
 * every permission check in the normal API, and means a missed event can never
 * leave wrong data on screen — the next refetch corrects it.
 */
export function keysFor(event: LiveEvent): QueryKey[] {
  const id = event.householdId;
  switch (event.type) {
    case "notifications":
      return [["notifications"]];
    case "membership":
    case "households":
      return [["me"], ...(id ? [h(id, "members")] : [])];
  }
  if (!id) return [];
  switch (event.type) {
    case "transactions":
      return [
        h(id, "transactions"),
        h(id, "reports"),
        h(id, "budgets"),
        h(id, "accounts"),
        h(id, "goals"),
      ];
    case "accounts":
      return [h(id, "accounts"), h(id, "reports"), h(id, "goals")];
    case "categories":
      return [h(id, "categories"), h(id, "reports"), h(id, "budgets")];
    case "budgets":
      return [h(id, "budgets")];
    case "goals":
      return [h(id, "goals")];
    case "recurring_rules":
      return [h(id, "recurring-rules"), h(id, "reports", "recurring")];
    case "imports":
      return [h(id, "imports")];
    case "household_members":
      return [h(id, "members"), ["me"]];
    case "household_invitations":
      return [h(id, "invitations")];
    default:
      return [];
  }
}

/**
 * One EventSource per tab, for the whole app. EventSource reconnects by itself
 * (the server suggests 3 s); after ANY reconnect we refetch everything we show,
 * because events sent while we were away are gone.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const [online, setOnline] = useState<Record<string, string[]>>({});
  const meRef = useRef(me);
  useEffect(() => {
    meRef.current = me;
  }, [me]);
  const signedIn = Boolean(me);

  useEffect(() => {
    if (!signedIn) return;
    const source = new EventSource("/api/v1/events");
    let wasOpen = false;

    // Coalesce bursts (an import sends an event per chunk) into one refetch per key.
    const pending = new Map<string, QueryKey>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = (keys: QueryKey[]) => {
      for (const key of keys) pending.set(JSON.stringify(key), key);
      timer ??= setTimeout(() => {
        for (const key of pending.values()) void queryClient.invalidateQueries({ queryKey: key });
        pending.clear();
        timer = null;
      }, 150);
    };

    source.addEventListener("ready", (message) => {
      const { online: snapshot } = JSON.parse((message as MessageEvent).data) as {
        online: Record<string, string[]>;
      };
      setOnline(snapshot);
      setStatus("live");
      // Reconnected after a gap: we may have missed changes. Resync everything.
      if (wasOpen) void queryClient.invalidateQueries();
      wasOpen = true;
    });

    source.addEventListener("unauthorized", () => {
      source.close();
      // The session was revoked elsewhere ("sign out everywhere"). A full page load
      // on purpose: it discards every piece of in-memory state from that session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    });

    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as LiveEvent;
      if (event.type === "resync") return void queryClient.invalidateQueries();
      if (event.type === "presence" && event.householdId && event.userId) {
        const { householdId, userId } = event;
        setOnline((current) => {
          const others = (current[householdId] ?? []).filter((u) => u !== userId);
          return { ...current, [householdId]: event.online ? [...others, userId] : others };
        });
        return;
      }
      invalidate(keysFor(event));
      announce(event);
    };

    source.onerror = () => setStatus(wasOpen ? "reconnecting" : "connecting");

    /** "Jamie added 2 transactions" — only for OTHER people's changes. */
    function announce(event: LiveEvent) {
      const myId = meRef.current?.id;
      if (event.type === "membership" && event.users?.includes(myId ?? "")) {
        const still = meRef.current?.households.some((x) => x.id === event.householdId);
        // Removed from the household I'm looking at? Leave it.
        if (still && event.op !== "insert") {
          void queryClient.invalidateQueries({ queryKey: ["me"] }).then(() => {
            const me = queryClient.getQueryData<MeDto>(["me"]);
            if (!me?.households.some((x) => x.id === event.householdId)) {
              toast.info("You no longer have access to that household");
              if (window.location.pathname.startsWith(`/app/${event.householdId}`))
                router.push("/app");
            }
          });
        }
        return;
      }
      if (event.type !== "transactions" || event.op !== "insert" || !event.householdId) return;
      const others = (event.actors ?? []).filter((a) => a !== myId);
      if (others.length === 0) return;
      const members = queryClient.getQueryData<MemberDto[]>(h(event.householdId, "members"));
      const name =
        members?.find((m) => m.userId === others[0])?.displayName.split(" ")[0] ?? "Someone";
      const count = event.count ?? 1;
      toast(
        `${name} added ${count === 1 ? "a transaction" : `${count.toLocaleString("en-US")} transactions`}`,
        {
          description: "Your lists and charts are already up to date.",
        },
      );
    }

    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
  }, [signedIn, queryClient, router]);

  const value = useMemo(() => ({ status, online }), [status, online]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
