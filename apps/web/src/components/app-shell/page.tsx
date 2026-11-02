"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { ease } from "@/lib/motion";

/**
 * Standard page frame: a consistent max width, padding and header, plus an
 * entrance transition so navigating between pages feels continuous instead of
 * "flashing" new content in.
 */
export function Page({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: ease.outQuint }}
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-10"
    >
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-headline">{title}</h1>
          {/* A <div>, not a <p>: descriptions may contain block elements (e.g. a
              loading skeleton), and <div> inside <p> is invalid HTML that breaks hydration. */}
          {description && <div className="text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </header>
      {children}
    </motion.div>
  );
}
