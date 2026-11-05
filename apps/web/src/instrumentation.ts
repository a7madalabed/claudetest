/**
 * Runs once when the Next.js server starts (Next's instrumentation hook).
 *
 * Next also compiles this file for its Edge runtime, which has no `process.once`,
 * so the Node-only code lives in ./shutdown and is loaded on the Node runtime only.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installShutdownCap } = await import("./shutdown");
    installShutdownCap();
  }
}
