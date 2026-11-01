import { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Keyset-pagination cursors. A cursor is the sort key of the LAST row the client
 * saw — (occurredOn, id) — encoded as opaque base64url. "Opaque" means clients
 * must treat it as a token, not parse it, so we can change the format later.
 */
const CursorSchema = z.object({ d: z.iso.date(), id: z.uuid() });
export type TransactionCursor = { occurredOn: string; id: string };

export function encodeCursor(cursor: TransactionCursor): string {
  return Buffer.from(JSON.stringify({ d: cursor.occurredOn, id: cursor.id })).toString("base64url");
}

export function decodeCursor(raw: string): TransactionCursor {
  try {
    const parsed = CursorSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    return { occurredOn: parsed.d, id: parsed.id };
  } catch {
    throw new AppError(
      400,
      "invalid_cursor",
      "Invalid cursor",
      "The pagination cursor is malformed or expired.",
    );
  }
}
