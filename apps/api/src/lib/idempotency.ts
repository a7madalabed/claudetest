import { createHash } from "node:crypto";
import {
  and,
  eq,
  idempotencyKeys,
  isPgError,
  type Database,
  type DbTransaction,
} from "@ledgerly/db";
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./errors.js";

const HEADER = "idempotency-key";

/**
 * Runs a "create" operation at most once per Idempotency-Key (the pattern Stripe
 * popularised). Flow:
 *
 *   no header            → just run it
 *   key seen, same body  → replay the stored response (nothing is created twice)
 *   key seen, other body → 422: the client reused a key for a different request
 *   new key              → run it AND store the response in the SAME database
 *                          transaction, so "created" and "remembered" can't diverge
 *
 * If two identical requests race, both try to insert the key; the primary key
 * makes one fail, its whole transaction (including the created row) rolls back,
 * and it replays the winner's response instead.
 */
export async function idempotent<T>(
  db: Database,
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  operation: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  const key = request.headers[HEADER];
  if (key === undefined) {
    const result = await db.transaction(operation);
    reply.status(status);
    return result;
  }
  if (typeof key !== "string" || key.length < 1 || key.length > 255) {
    throw new AppError(
      400,
      "invalid_idempotency_key",
      "Invalid Idempotency-Key",
      "Use 1–255 characters, e.g. a UUID.",
    );
  }

  const userId = request.user!.id;
  const requestHash = createHash("sha256")
    .update(`${request.method} ${request.url}\n${JSON.stringify(request.body ?? null)}`)
    .digest("hex");

  const replay = async (): Promise<T | undefined> => {
    const [stored] = await db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)));
    if (!stored) return undefined;
    if (stored.requestHash !== requestHash) {
      throw new AppError(
        422,
        "idempotency_key_reused",
        "Idempotency-Key reused",
        "This key was already used for a different request. Generate a new key per operation.",
      );
    }
    reply.status(stored.responseStatus).header("idempotent-replayed", "true");
    return stored.responseBody as T;
  };

  const previous = await replay();
  if (previous !== undefined) return previous;

  try {
    const result = await db.transaction(async (tx) => {
      const body = await operation(tx);
      await tx.insert(idempotencyKeys).values({
        userId,
        key,
        requestHash,
        responseStatus: status,
        responseBody: JSON.parse(JSON.stringify(body)),
      });
      return body;
    });
    reply.status(status);
    return result;
  } catch (error) {
    if (isPgError(error, "uniqueViolation", "idempotency_keys_pkey")) {
      const winner = await replay();
      if (winner !== undefined) return winner;
    }
    throw error;
  }
}
