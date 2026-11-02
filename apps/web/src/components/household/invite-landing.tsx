"use client";

import { Home, LogOut, MailX } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { MeSchema } from "@ledgerly/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { spring } from "@/lib/motion";
import {
  useAcceptInvitation,
  useDeclineInvitation,
  useInvitationPreview,
} from "@/lib/query/household";
import { authFlags } from "@/lib/query/client";

/** Sign out, then sign in as the invited address — and come back here. */
async function switchAccount(loginUrl: string) {
  authFlags.signingOut = true;
  await api("/v1/auth/logout", { method: "POST" }).catch(() => {});
  // A full page load: nothing of the previous account stays in memory.
  window.location.assign(loginUrl);
}

const STATUS_TEXT = {
  expired: "This invitation has expired. Ask for a new one.",
  accepted: "This invitation has already been used.",
  declined: "This invitation was declined.",
  revoked: "This invitation was cancelled by the household's owner.",
} as const;

/**
 * The invitee's view. It works signed out (shows who invited you, and offers
 * sign-in or sign-up that come straight back here), signed in as the right
 * person (Join / Decline), and signed in as someone else (explains, offers to
 * switch accounts) — instead of failing with a confusing error.
 */
export function InviteLanding({ token }: { token: string }) {
  const router = useRouter();
  const preview = useInvitationPreview(token);
  // "Am I signed in?" — a 401 here just means no; it must not redirect to /login.
  const me = useQuery({
    queryKey: ["invite-me"],
    queryFn: () => api("/v1/me", { schema: MeSchema }).catch(() => null),
    retry: false,
    // Always re-ask when this page appears: you may have JUST signed up or in
    // (client-side navigation keeps the cache, and "signed out" would be stale).
    staleTime: 0,
    refetchOnMount: "always",
  });
  const accept = useAcceptInvitation(token);
  const decline = useDeclineInvitation(token);
  const here = `/invite/${token}`;

  if (preview.isPending || me.isPending || me.isFetching) {
    return <Skeleton className="h-72 rounded-2xl" />;
  }

  if (preview.isError) {
    return (
      <Message icon={MailX} title="This link doesn't work">
        It may have been mistyped, or the invitation was replaced by a newer one.
      </Message>
    );
  }

  const invitation = preview.data;
  if (invitation.status !== "pending") {
    return (
      <Message icon={MailX} title={`Invitation to ${invitation.householdName}`}>
        {STATUS_TEXT[invitation.status]}
      </Message>
    );
  }

  const user = me.data;
  const rightPerson = user && user.email.toLowerCase() === invitation.email.toLowerCase();
  const query = `next=${encodeURIComponent(here)}&email=${encodeURIComponent(invitation.email)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring.smooth}
    >
      <Card className="space-y-6 p-6 text-center sm:p-8">
        <motion.span
          initial={{ scale: 0.6, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={spring.bouncy}
          className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary-subtle text-primary"
        >
          <Home className="size-7" />
        </motion.span>
        <div className="space-y-2">
          <h1 className="text-headline">Join {invitation.householdName}</h1>
          <p className="text-muted-foreground">
            {invitation.invitedByName ?? "Someone"} invited <strong>{invitation.email}</strong> to
            share this household on Ledgerly as{" "}
            {invitation.role === "editor" ? "an editor" : "a viewer"}.
          </p>
        </div>

        {rightPerson ? (
          <div className="grid gap-2">
            <Button
              size="lg"
              disabled={accept.isPending}
              onClick={() =>
                accept.mutate(undefined, {
                  onSuccess: ({ householdId }) => {
                    toast.success(`Welcome to ${invitation.householdName}`);
                    router.push(`/app/${householdId}`);
                  },
                  onError: (error) => toast.error(errorMessage(error)),
                })
              }
            >
              Join household
            </Button>
            <Button
              variant="ghost"
              disabled={decline.isPending}
              onClick={() =>
                decline.mutate(undefined, { onError: (error) => toast.error(errorMessage(error)) })
              }
            >
              No thanks
            </Button>
          </div>
        ) : user ? (
          <div className="space-y-3">
            <p className="rounded-xl bg-warning-subtle p-3 text-sm text-warning">
              You&apos;re signed in as <strong>{user.email}</strong>. This invitation only works for{" "}
              <strong>{invitation.email}</strong>.
            </p>
            <Button variant="outline" onClick={() => void switchAccount(`/login?${query}`)}>
              <LogOut /> Sign in as {invitation.email}
            </Button>
          </div>
        ) : (
          <div className="grid gap-2">
            <Button asChild size="lg">
              <Link href={`/signup?${query}`}>Create an account to join</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href={`/login?${query}`}>I already have an account</Link>
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

function Message({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof MailX;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="space-y-3 p-8 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" />
      <h1 className="text-title">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
      <Button asChild variant="ghost">
        <Link href="/app">Go to Ledgerly</Link>
      </Button>
    </Card>
  );
}
