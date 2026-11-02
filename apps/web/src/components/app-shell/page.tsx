"use client";

import type { ReactNode } from "react";

/**
 * Standard page frame: a consistent max width, padding and header, plus an
 * entrance transition so navigating between pages feels continuous instead of
 * "flashing" new content in.
 *
 * The entrance is a CSS animation, not a Motion one (Stage 12). A JavaScript
 * animation starts at opacity 0 and can only fade in AFTER the page's JS has
 * loaded and hydrated — on a mid-range phone the server-rendered content sat
 * invisible for ~1.5–2 s. CSS animations start the moment the HTML arrives.
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
    <div className="mx-auto w-full max-w-6xl animate-page-in px-4 py-6 sm:px-8 sm:py-10">
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
    </div>
  );
}
