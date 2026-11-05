"use client";

import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/errors";
import { useMe, useResendVerification } from "@/lib/query/hooks";

/**
 * Until the email is confirmed (Stage 15): a quiet reminder, with a resend
 * button. Joining households and receiving alert emails need a confirmed address.
 */
export function VerifyEmailBanner() {
  const { data: me } = useMe();
  const resend = useResendVerification();
  if (!me || me.emailVerified) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-warning-subtle px-4 py-2 text-sm text-warning"
    >
      <MailWarning className="size-4 shrink-0" aria-hidden />
      <span>
        Confirm your email: we sent a link to <strong>{me.email}</strong>.
      </span>
      <button
        type="button"
        disabled={resend.isPending || resend.isSuccess}
        className="font-medium underline underline-offset-4 disabled:no-underline disabled:opacity-70"
        onClick={() =>
          resend.mutate(undefined, {
            onSuccess: () => toast.success("Sent — check your inbox"),
            onError: (error) => toast.error(errorMessage(error)),
          })
        }
      >
        {resend.isSuccess ? "Sent" : "Resend"}
      </button>
    </div>
  );
}
