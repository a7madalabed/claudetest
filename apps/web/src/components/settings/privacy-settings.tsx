"use client";

import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { FormAlert } from "@/components/auth/form-alert";
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
import { PasswordInput } from "@/components/ui/password-input";
import { errorMessage } from "@/lib/api/errors";
import { useDeleteAccount, useMe } from "@/lib/query/hooks";
import { Section } from "./section";

/** Download everything as JSON (Stage 15: data portability). */
export function YourDataCard() {
  const [busy, setBusy] = useState(false);
  async function download() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/me/export", { credentials: "same-origin" });
      if (!response.ok) throw new Error("The export didn't work. Try again in a minute.");
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
        "ledgerly-export.json";
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: name });
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section
      title="Your data"
      description="Download everything in your households — accounts, categories, transactions, budgets, goals and automations — as a JSON file."
    >
      <Button variant="outline" onClick={download} loading={busy}>
        <Download /> Download my data
      </Button>
    </Section>
  );
}

/** Leave for good (Stage 15). Password (and a 2FA code if it's on) required. */
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Delete account"
      description="Permanently delete your account. Households only you use are deleted with it; households you share stay with the other members."
    >
      <Button variant="destructive" onClick={() => setOpen(true)}>
        <Trash2 /> Delete my account
      </Button>
      <DeleteAccountDialog open={open} onOpenChange={setOpen} />
    </Section>
  );
}

function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: me } = useMe();
  const remove = useDeleteAccount();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          remove.reset();
          setPassword("");
          setCode("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This can&apos;t be undone. Consider downloading your data first.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            remove.mutate(
              { password, ...(me?.mfaEnabled && { code }) },
              // A full page load: every cached query belonged to the deleted account.
              { onSuccess: () => window.location.replace("/login?deleted=1") },
            );
          }}
        >
          <FormAlert error={remove.error} />
          <Field label="Password">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {me?.mfaEnabled && (
            <Field label="Authenticator or recovery code">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                className="font-mono"
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              loading={remove.isPending}
              disabled={!password || (me?.mfaEnabled === true && code.length < 6)}
            >
              Delete forever
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
