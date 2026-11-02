/**
 * The API names its cookie `__Host-ledgerly_session` in production (HTTPS) and
 * `ledgerly_session` in local development. The web app only ever checks whether
 * it EXISTS — it can't (and shouldn't) validate it; only the API can.
 */
export const SESSION_COOKIE_NAMES = ["__Host-ledgerly_session", "ledgerly_session"] as const;
