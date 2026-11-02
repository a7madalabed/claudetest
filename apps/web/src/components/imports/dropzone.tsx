"use client";

import { FileSpreadsheet, LoaderCircle, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useRef, useState, type DragEvent } from "react";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Drag a file in, or click (or press Enter/Space) to browse. It's a real
 * <input type="file"> underneath, so keyboard and screen-reader users get the
 * native file picker — the drag-and-drop is an enhancement, not the only way.
 */
export function Dropzone({
  onFile,
  busy,
  disabled,
}: {
  onFile: (file: File) => void;
  busy: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // dragenter/dragleave fire for every child element; count them to know when we really left.
  const depth = useRef(0);

  function accept(file: File | undefined) {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name) && !file.type.includes("csv")) {
      return setError("That doesn't look like a CSV file. Export a .csv from your bank.");
    }
    if (file.size > MAX_BYTES) return setError("Files can be at most 5 MB.");
    setError(null);
    onFile(file);
  }

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => e.preventDefault(), // required to allow dropping
    onDragLeave: () => {
      depth.current -= 1;
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (!disabled && !busy) accept(e.dataTransfer.files[0]);
    },
  };

  return (
    <div className="space-y-2">
      <motion.label
        htmlFor={id}
        {...handlers}
        animate={{ scale: dragging ? 1.01 : 1 }}
        transition={spring.snappy}
        className={cn(
          "relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          "focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/20",
          dragging
            ? "border-primary bg-primary-subtle"
            : "border-border bg-surface hover:bg-muted/40",
          (disabled || busy) && "pointer-events-none opacity-60",
        )}
      >
        <input
          ref={input}
          id={id}
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = ""; // choosing the same file again should work too
          }}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={busy ? "busy" : dragging ? "drop" : "idle"}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.9 }}
            transition={spring.snappy}
            className="flex size-14 items-center justify-center rounded-2xl bg-primary-subtle text-primary"
          >
            {busy ? (
              <LoaderCircle className="size-7 animate-spin" />
            ) : dragging ? (
              <FileSpreadsheet className="size-7" />
            ) : (
              <UploadCloud className="size-7" />
            )}
          </motion.span>
        </AnimatePresence>
        <span className="text-base font-medium">
          {busy ? "Reading your file…" : dragging ? "Drop it here" : "Drop a CSV from your bank"}
        </span>
        <span className="text-sm text-muted-foreground">
          or{" "}
          <span className="font-medium text-primary underline-offset-4 hover:underline">
            browse your files
          </span>{" "}
          · up to 5 MB
        </span>
      </motion.label>
      {error && (
        <p role="alert" className="text-sm font-medium text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
