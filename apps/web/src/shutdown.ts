/**
 * A CAP on graceful shutdown (Stage 14). On SIGTERM, Next's own handler stops
 * accepting connections and waits for open requests to finish — correct, but
 * a live-update stream (Server-Sent Events) never "finishes", so a deploy
 * would wait for Docker's hard kill. This gives in-flight requests time to
 * complete, then exits; cut streams reconnect by themselves (Stage 11).
 *
 * Node.js only: imported from instrumentation.ts on the Node runtime alone.
 */
export function installShutdownCap() {
  const capMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);
  process.once("SIGTERM", () => {
    setTimeout(() => process.exit(0), capMs).unref();
  });
}
