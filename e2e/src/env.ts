/*
 * Where the end-to-end stack runs. Its own ports and its own database, so the
 * suite can run while `pnpm dev` is up, and never touches your development data.
 */
export const E2E_API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
export const E2E_WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);

/** Mailpit (Stage 15): real SMTP in, a JSON API out, so tests can open the emails the app sends. */
export const E2E_SMTP_URL = process.env.E2E_SMTP_URL ?? "smtp://localhost:1025";
export const E2E_MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? "http://localhost:8025";

/** The API, as the web server reaches it (server to server). */
export const E2E_API_URL = `http://127.0.0.1:${E2E_API_PORT}`;
/** The web app, as the browser sees it. `localhost` counts as a secure context, so Secure cookies work over http. */
export const E2E_WEB_URL = `http://localhost:${E2E_WEB_PORT}`;

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://ledgerly:ledgerly@localhost:5432/ledgerly_e2e_test";
