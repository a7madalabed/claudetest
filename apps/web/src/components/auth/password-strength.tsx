"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * A simple, honest strength hint based on LENGTH and variety — the factors that
 * matter (Stage 5 §3.4). It's guidance, not a gate: the server has the final say.
 */
export function passwordScore(password: string): 0 | 1 | 2 | 3 {
  if (password.length < 12) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/, /\s|-/].filter((re) =>
    re.test(password),
  ).length;
  if (password.length >= 20 || (password.length >= 16 && variety >= 2)) return 3;
  if (variety >= 2 || password.length >= 16) return 2;
  return 1;
}

const labels = ["Too short", "Okay", "Good", "Strong"] as const;
const colors = ["bg-negative", "bg-warning", "bg-chart-2", "bg-positive"] as const;

export function PasswordStrength({ password }: { password: string }) {
  const score = password ? passwordScore(password) : null;
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="grid grid-cols-3 gap-1.5">
        {[1, 2, 3].map((bar) => (
          <div key={bar} className="h-1 overflow-hidden rounded-full bg-muted">
            <motion.div
              className={cn("h-full rounded-full", score !== null && colors[score])}
              initial={false}
              animate={{
                width:
                  score !== null && (score >= bar || (score === 0 && bar === 1)) ? "100%" : "0%",
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          </div>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">
        {score === null
          ? "Use 12+ characters. A few random words works great."
          : `Strength: ${labels[score]}`}
      </p>
    </div>
  );
}
