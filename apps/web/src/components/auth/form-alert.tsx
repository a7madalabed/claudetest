"use client";

import { AlertCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { errorMessage, isApiError } from "@/lib/api/errors";

/** Titles too generic to be worth showing above the detail. */
const GENERIC_TITLES = new Set([
  "Invalid request",
  "Unprocessable request",
  "Bad request",
  "Conflict",
  "Forbidden",
  "Unauthorized",
  "Something went wrong",
]);

/**
 * An error banner that grows in smoothly. For API errors it shows the problem's
 * title as a headline ("Invalid email or password") and its detail underneath.
 */
export function FormAlert({ error }: { error?: unknown }) {
  const title =
    isApiError(error) && !GENERIC_TITLES.has(error.title) && error.status < 500
      ? error.title
      : undefined;
  const message = error ? errorMessage(error) : null;

  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key={message}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl bg-negative-subtle px-3.5 py-3 text-sm text-negative"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>
              {title && <strong className="block font-medium">{title}</strong>}
              {message !== title && (
                <span className={title ? "opacity-90" : undefined}>{message}</span>
              )}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
