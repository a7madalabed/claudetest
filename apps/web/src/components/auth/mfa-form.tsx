"use client";

import { KeyRound, Smartphone } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { OtpInput } from "@/components/ui/otp-input";
import { isApiError } from "@/lib/api/errors";
import { useVerifyMfa } from "@/lib/query/hooks";
import { FormAlert } from "./form-alert";
import { safeNext } from "./login-form";

export function MfaForm({ next }: { next?: string }) {
  const router = useRouter();
  const verify = useVerifyMfa();
  const [mode, setMode] = useState<"app" | "recovery">("app");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");

  function submit(value: string) {
    verify.mutate(value, {
      onSuccess: () => {
        router.replace(safeNext(next));
        router.refresh();
      },
      onError: (error) => {
        // The pending sign-in expired (10 minutes) — start again.
        if (isApiError(error) && error.status === 401 && error.code !== "invalid_mfa_code")
          router.replace("/login");
        setCode("");
      },
    });
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(mode === "app" ? code : recovery);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5">
      <FormAlert error={verify.error} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={mode}
          initial={{ opacity: 0, x: mode === "app" ? -12 : 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: mode === "app" ? 12 : -12 }}
          transition={{ duration: 0.18 }}
        >
          {mode === "app" ? (
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={submit}
              invalid={isApiError(verify.error) && verify.error.code === "invalid_mfa_code"}
              autoFocus
              label="6-digit code from your authenticator app"
            />
          ) : (
            <Field
              label="Recovery code"
              description="One of the codes you saved when you turned on 2FA."
            >
              <Input
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                autoFocus
                autoComplete="off"
                className="font-mono uppercase"
              />
            </Field>
          )}
        </motion.div>
      </AnimatePresence>

      <Button
        type="submit"
        size="lg"
        loading={verify.isPending}
        disabled={mode === "app" ? code.length < 6 : recovery.length < 12}
        className="w-full"
      >
        Verify
      </Button>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "app" ? "recovery" : "app");
          verify.reset();
        }}
        className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {mode === "app" ? <KeyRound className="size-4" /> : <Smartphone className="size-4" />}
        {mode === "app" ? "Use a recovery code instead" : "Use your authenticator app"}
      </button>
    </form>
  );
}
