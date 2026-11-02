import { parse } from "csv-parse/sync";

/** Imports are capped so one upload can't hog a worker (or the database) for long. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 20_000;

/**
 * CSV is deceptively hard to parse by hand: quoted fields may contain commas,
 * quotes ("") and line breaks; Excel adds a byte-order mark; European banks use
 * semicolons. A battle-tested parser handles all of it.
 */
export function parseCsv(text: string): string[][] {
  const rows = parse(text, {
    bom: true,
    delimiter: [",", ";", "\t"],
    relax_column_count: true, // banks love footer lines with fewer columns
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  }) as string[][];
  return rows.filter((row) => row.some((cell) => cell !== ""));
}
