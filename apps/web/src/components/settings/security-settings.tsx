"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PasswordSchema, type SessionDto } from "@ledgerly/shared";
import {
  Check,
  Copy,
  Download,
  Laptop,
  LogOut,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import QRCode from "qrcode";
import { useEffect, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Page } from "@/components/app-shell/page";
import { FormAlert } from "@/components/auth/form-alert";
import { PasswordStrength } from "@/components/auth/password-strength";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/components/ui/password-input";
import { Skeleton } from "@/components/ui/skeleton";
import { isApiError } from "@/lib/api/errors";
import { fadeUp, stagger } from "@/lib/motion";
import {
  useChangePassword,
  useMe,
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  useTotpDisable,
  useTotpEnable,
  useTotpSetup,
} from "@/lib/query/hooks";

export function SecuritySettings() {
  return (
    <Page
      title="Security"
      description="Keep your account safe: two-factor authentication, your password, and signed-in devices."
    >
      <motion.div
        variants={stagger(0.08)}
        initial="hidden"
        animate="visible"
        className="grid max-w-3xl gap-5"
      >
        <motion.div variants={fadeUp}>
          <TwoFactorCard />
        </motion.div>
        <motion.div variants={fadeUp}>
          <PasswordCard />
        </motion.div>
        <motion.div variants={fadeUp}>
          <SessionsCard />
        </motion.div>
      </motion.div>
    </Page>
  );
}

function Section({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-0">
        <div className="space-y-1">
          <h2 className="text-title">{title}</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        </div>
        {badge}
      </div>
      <div className="p-6">{children}</div>
    </Card>
  );
}

// ─── Two-factor authentication ───────────────────────────────────────────────

function TwoFactorCard() {
  const { data: me } = useMe();
  const setup = useTotpSetup();
  const enable = useTotpEnable();
  const [code, setCode] = useState("");
  const [qrSvg, setQrSvg] = useState<string>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>();
  const [disableOpen, setDisableOpen] = useState(false);

  // The QR code is drawn IN THE BROWSER. Sending the secret to an online QR
  // service would leak the one thing that must stay between you and us.
  useEffect(() => {
    if (!setup.data) return;
    QRCode.toString(setup.data.otpauthUri, {
      type: "svg",
      margin: 0,
      errorCorrectionLevel: "M",
    }).then(setQrSvg);
  }, [setup.data]);

  const enabled = me?.mfaEnabled && !recoveryCodes;

  return (
    <Section
      title="Two-factor authentication"
      description="Require a code from an authenticator app (1Password, Google Authenticator, Authy…) when you sign in. A stolen password alone won't be enough."
      badge={
        me?.mfaEnabled ? (
          <Badge tone="positive">
            <ShieldCheck /> On
          </Badge>
        ) : (
          <Badge tone="warning">
            <ShieldOff /> Off
          </Badge>
        )
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {recoveryCodes ? (
          <Step key="codes">
            <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(undefined)} />
          </Step>
        ) : enabled ? (
          <Step key="enabled">
            <Button variant="outline" onClick={() => setDisableOpen(true)}>
              Turn off two-factor
            </Button>
          </Step>
        ) : setup.data ? (
          <Step key="scan">
            <div className="grid gap-6 sm:grid-cols-[auto_1fr]">
              <div className="size-44 rounded-2xl bg-white p-3 shadow-elevation-1 [&_svg]:size-full">
                {qrSvg ? (
                  <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
                ) : (
                  <Skeleton className="size-full" />
                )}
              </div>
              <div className="space-y-4">
                <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
                  <li>Scan the QR code with your authenticator app.</li>
                  <li>Enter the 6-digit code it shows.</li>
                </ol>
                <details className="text-sm">
                  <summary className="cursor-pointer text-primary">
                    Can&apos;t scan? Enter the key manually
                  </summary>
                  <code className="mt-2 block rounded-lg bg-muted px-3 py-2 font-mono text-xs break-all">
                    {setup.data.secret}
                  </code>
                </details>
                <FormAlert error={enable.error} />
                <OtpInput
                  value={code}
                  onChange={setCode}
                  invalid={isApiError(enable.error)}
                  onComplete={(value) =>
                    enable.mutate(value, {
                      onSuccess: (result) => setRecoveryCodes(result.recoveryCodes),
                      onError: () => setCode(""),
                    })
                  }
                />
                {enable.isPending && <p className="text-sm text-muted-foreground">Verifying…</p>}
              </div>
            </div>
          </Step>
        ) : (
          <Step key="start">
            <Button loading={setup.isPending} onClick={() => setup.mutate()}>
              <ShieldCheck /> Set up two-factor
            </Button>
          </Step>
        )}
      </AnimatePresence>
      <DisableTwoFactorDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        onDisabled={() => setup.reset()}
      />
    </Section>
  );
}

/** Each step of the 2FA flow cross-fades into the next. */
function Step({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18 }}
    >
      {children}
    </motion.div>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  function download() {
    const url = URL.createObjectURL(
      new Blob([`Ledgerly recovery codes\n\n${text}\n`], { type: "text/plain" }),
    );
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: "ledgerly-recovery-codes.txt",
    });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-warning-subtle p-4 text-sm text-warning">
        <strong>Save these recovery codes now.</strong> Each one signs you in once if you lose your
        phone. They won&apos;t be shown again.
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-4 font-mono text-sm sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
        </Button>
        <Button variant="outline" onClick={download}>
          <Download /> Download
        </Button>
        <Button
          onClick={() => {
            toast.success("Two-factor authentication is on");
            onDone();
          }}
        >
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

function DisableTwoFactorDialog({
  open,
  onOpenChange,
  onDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisabled: () => void;
}) {
  const disable = useTotpDisable();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          disable.reset();
          setPassword("");
          setCode("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Turn off two-factor authentication?</DialogTitle>
          <DialogDescription>
            Confirm with your password and a current code. Your account will be protected by your
            password only.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            disable.mutate(
              { password, code },
              {
                onSuccess: () => {
                  toast("Two-factor authentication turned off");
                  onDisabled();
                  onOpenChange(false);
                },
              },
            );
          }}
        >
          <FormAlert error={disable.error} />
          <Field label="Password">
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Field label="Authenticator or recovery code">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
              className="font-mono"
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              loading={disable.isPending}
              disabled={!password || code.length < 6}
            >
              Turn off
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Password ────────────────────────────────────────────────────────────────

const ChangePasswordForm = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: PasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });

function PasswordCard() {
  const change = useChangePassword();
  const form = useForm<z.infer<typeof ChangePasswordForm>>({
    resolver: zodResolver(ChangePasswordForm),
    mode: "onTouched",
    defaultValues: { currentPassword: "", newPassword: "", confirm: "" },
  });
  const { errors } = form.formState;
  const newPassword = useWatch({ control: form.control, name: "newPassword" });

  const onSubmit = form.handleSubmit(({ currentPassword, newPassword }) =>
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          form.reset();
          toast.success("Password changed", {
            description: "You've been signed out on your other devices.",
          });
        },
        onError: (error) => {
          if (!isApiError(error)) return;
          for (const field of ["currentPassword", "newPassword"] as const) {
            const message = error.fieldError(field);
            if (message) form.setError(field, { message });
          }
        },
      },
    ),
  );

  const fieldLevel = isApiError(change.error) && change.error.fieldErrors.length > 0;

  return (
    <Section
      title="Password"
      description="Use a long passphrase you don't use anywhere else. Changing it signs you out on every other device."
    >
      <form onSubmit={onSubmit} noValidate className="grid max-w-md gap-4">
        <FormAlert error={fieldLevel ? null : change.error} />
        <Field label="Current password" error={errors.currentPassword?.message}>
          <PasswordInput autoComplete="current-password" {...form.register("currentPassword")} />
        </Field>
        <Field label="New password" error={errors.newPassword?.message}>
          <PasswordInput autoComplete="new-password" {...form.register("newPassword")} />
        </Field>
        <PasswordStrength password={newPassword} />
        <Field label="Confirm new password" error={errors.confirm?.message}>
          <PasswordInput autoComplete="new-password" {...form.register("confirm")} />
        </Field>
        <div>
          <Button type="submit" loading={change.isPending}>
            Change password
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/** "Mozilla/5.0 (Macintosh…) … Chrome/131…" → "Chrome on macOS". Good enough for humans. */
function describeDevice(userAgent: string | null) {
  if (!userAgent) return { label: "Unknown device", mobile: false };
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : /curl/i.test(userAgent)
            ? "curl"
            : "Browser";
  const os = /iPhone|iPad/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X|Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return {
    label: os ? `${browser} on ${os}` : browser,
    mobile: /iPhone|Android|Mobile/.test(userAgent),
  };
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function timeAgo(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return relative.format(Math.round(hours / 24), "day");
}

function SessionsCard() {
  const { data: sessions, isPending } = useSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const others = sessions?.filter((s) => !s.current).length ?? 0;

  return (
    <Section
      title="Signed-in devices"
      description="If you don't recognise a device, sign it out and change your password."
    >
      {isPending ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            <AnimatePresence initial={false}>
              {sessions?.map((session: SessionDto) => {
                const device = describeDevice(session.userAgent);
                const Icon = device.mobile ? Smartphone : Laptop;
                return (
                  <motion.li
                    key={session.id}
                    layout
                    exit={{ opacity: 0, x: 16 }}
                    className="flex items-center gap-3 py-3"
                  >
                    <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {device.label}{" "}
                        {session.current && <Badge tone="primary">This device</Badge>}
                      </p>
                      <p className="text-caption text-muted-foreground">
                        {session.ipAddress ?? "Unknown IP"} · active {timeAgo(session.lastSeenAt)}
                      </p>
                    </div>
                    {!session.current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => revoke.mutate(session.id)}
                        aria-label={`Sign out ${device.label}`}
                      >
                        Sign out
                      </Button>
                    )}
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          {others > 0 && (
            <Button
              variant="outline"
              className="mt-4"
              loading={revokeOthers.isPending}
              onClick={() =>
                revokeOthers.mutate(undefined, {
                  onSuccess: () => toast.success("Signed out of all other devices"),
                })
              }
            >
              <LogOut /> Sign out all other devices
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
