"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreateInvitationSchema, type CreateInvitationInput } from "@ledgerly/shared";
import { Check, Copy, Eye, PencilLine } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { errorMessage, isApiError } from "@/lib/api/errors";
import { spring } from "@/lib/motion";
import { useInvite } from "@/lib/query/household";
import { cn } from "@/lib/utils";

const ROLES = [
  {
    value: "editor",
    label: "Editor",
    hint: "Adds and edits transactions, budgets and goals",
    icon: PencilLine,
  },
  { value: "viewer", label: "Viewer", hint: "Sees everything, changes nothing", icon: Eye },
] as const;

export function InviteDialog({
  open,
  onOpenChange,
  householdId,
  householdName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  householdName: string;
}) {
  const invite = useInvite(householdId);
  const [created, setCreated] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const form = useForm<z.input<typeof CreateInvitationSchema>, unknown, CreateInvitationInput>({
    resolver: zodResolver(CreateInvitationSchema),
    defaultValues: { email: "", role: "editor" },
  });
  const { errors } = form.formState;

  // Every opening starts fresh (adjusted during render, not in an effect).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCreated(null);
      setCopied(false);
      form.reset({ email: "", role: "editor" });
    }
  }

  const onSubmit = form.handleSubmit((values) =>
    invite.mutate(values, {
      onSuccess: (result) => setCreated({ url: result.inviteUrl, email: result.invitation.email }),
      onError: (error) =>
        form.setError("email", {
          message: isApiError(error) && error.status === 409 ? error.detail : errorMessage(error),
        }),
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <AnimatePresence mode="wait" initial={false}>
          {created ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={spring.smooth}
              className="grid gap-5"
            >
              <DialogHeader>
                <DialogTitle>Invitation sent</DialogTitle>
                <DialogDescription>
                  We emailed a link to <strong>{created.email}</strong>. You can also share it
                  yourself — it only works for that email address, for 7 days.
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-2 pl-3">
                <code className="min-w-0 flex-1 truncate text-xs">{created.url}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard.writeText(created.url);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy link"}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => onOpenChange(false)}>Done</Button>
              </DialogFooter>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={onSubmit}
              noValidate
              className="grid gap-5"
              exit={{ opacity: 0 }}
            >
              <DialogHeader>
                <DialogTitle>Invite to {householdName}</DialogTitle>
                <DialogDescription>
                  They&apos;ll get an email with a link to join.
                </DialogDescription>
              </DialogHeader>
              <Field label="Email" error={errors.email?.message}>
                <Input
                  {...form.register("email")}
                  type="email"
                  autoComplete="off"
                  placeholder="partner@example.com"
                  autoFocus
                />
              </Field>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <div role="radiogroup" aria-label="Role" className="grid gap-2">
                    {ROLES.map(({ value, label, hint, icon: Icon }) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={field.value === value}
                        onClick={() => field.onChange(value)}
                        className={cn(
                          "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                          field.value === value
                            ? "border-primary bg-primary-subtle/60 ring-1 ring-primary"
                            : "border-border hover:bg-muted/50",
                        )}
                      >
                        <Icon
                          className={cn(
                            "mt-0.5 size-4",
                            field.value === value ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span>
                          <span className="block text-sm font-medium">{label}</span>
                          <span className="block text-caption text-muted-foreground">{hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={invite.isPending}>
                  Send invitation
                </Button>
              </DialogFooter>
            </motion.form>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
