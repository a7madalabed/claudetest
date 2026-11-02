"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A 6-digit one-time-code input.
 *
 * It LOOKS like six boxes, but it's ONE real <input>. That keeps everything
 * browsers and assistive tech already do right: paste the whole code, SMS/OS
 * autofill (autocomplete="one-time-code"), the numeric keypad on phones, and a
 * single label for screen readers. Six separate inputs break most of those.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  invalid = false,
  autoFocus = false,
  label = "Verification code",
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  return (
    <div className="relative" onClick={() => inputRef.current?.focus()}>
      <input
        ref={inputRef}
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={value}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d*"
        maxLength={length}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, length);
          onChange(digits);
          if (digits.length === length) onComplete?.(digits);
        }}
        className="absolute inset-0 z-10 w-full cursor-text opacity-0"
      />
      <motion.div
        aria-hidden
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${length}, minmax(0, 1fr))` }}
        // A gentle "no" shake when the code is wrong.
        animate={invalid ? { x: [0, -8, 8, -5, 5, 0] } : { x: 0 }}
        transition={{ duration: 0.4 }}
      >
        {Array.from({ length }, (_, index) => {
          const char = value[index];
          const active =
            focused &&
            (index === value.length || (index === length - 1 && value.length === length));
          return (
            <div
              key={index}
              className={cn(
                "flex h-14 items-center justify-center rounded-xl border bg-surface font-mono text-2xl tabular-nums shadow-elevation-1 transition-[border-color,box-shadow] duration-150",
                invalid
                  ? "border-negative"
                  : active
                    ? "border-ring ring-4 ring-ring/20"
                    : "border-input",
              )}
            >
              {char ? (
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 600, damping: 30 }}
                >
                  {char}
                </motion.span>
              ) : (
                active && <span className="h-6 w-px animate-pulse bg-foreground" />
              )}
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
