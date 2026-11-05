/**
 * Browser security headers for every page (Stage 15).
 *
 * The centrepiece is a Content Security Policy with a NONCE: a random value,
 * new on every response, that a <script> must carry to run. Next.js reads it
 * from the request and stamps it on its own scripts; next-themes gets it as a
 * prop. Script tags an attacker manages to inject can't know it, so they don't
 * run: cross-site scripting stops being "game over".
 *
 * 'strict-dynamic' lets a trusted (nonced) script load the code-split chunks
 * it needs; host allow-lists are then ignored, which is the point — they are
 * famously easy to bypass.
 */
export function contentSecurityPolicy(
  nonce: string,
  { https, dev }: { https: boolean; dev: boolean },
) {
  const directives = [
    "default-src 'self'",
    // Development only: React's dev tooling evaluates code for stack traces.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Animations and components set inline style ATTRIBUTES, which nonces can't
    // cover. Style injection is far less dangerous than script injection.
    "style-src 'self' 'unsafe-inline'",
    // data: and blob: for the 2FA QR code and the "download my data" file.
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // Everything the app fetches (API, live updates) is same-origin via /api.
    "connect-src 'self'",
    "object-src 'none'",
    // No other site may frame Ledgerly: clickjacking (an invisible Ledgerly
    // over a fake page, tricking you into clicking "Delete") is impossible.
    "frame-ancestors 'none'",
    // Forms can only post to us; <base> can't redirect relative URLs elsewhere.
    "form-action 'self'",
    "base-uri 'self'",
  ];
  // Only behind HTTPS: on plain-http localhost this would break every request.
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** The rest, same on every response. */
export const staticSecurityHeaders: Record<string, string> = {
  // Older browsers' version of frame-ancestors.
  "X-Frame-Options": "DENY",
  // Never guess a content type (e.g. run an "image" as a script).
  "X-Content-Type-Options": "nosniff",
  // Other sites see that a visitor came from Ledgerly, never which page.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Hardware Ledgerly will never need is switched off, even for injected code.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
