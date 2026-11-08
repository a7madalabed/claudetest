import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./globals.css";

/*
 * Two typefaces, both bundled (no request to a font service: the security
 * policy allows fonts from this site only, and a finance app shouldn't tell a
 * third party who's using it). Variable fonts: one file covers every weight.
 */
const besley = localFont({
  src: "./fonts/besley-latin-wght-normal.woff2",
  variable: "--font-besley",
  weight: "400 900",
  display: "swap",
});
const publicSans = localFont({
  src: "./fonts/public-sans-latin-wght-normal.woff2",
  variable: "--font-public-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Ledgerly", template: "%s · Ledgerly" },
  description: "Keep the household's books together.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf1e2" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1712" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // The per-response nonce from proxy.ts (Content Security Policy). Reading
  // headers also makes every page render per request, which nonces require.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: next-themes sets the theme class on <html> before
    // React loads, which would otherwise trigger a harmless mismatch warning.
    <html
      lang="en"
      className={`${publicSans.variable} ${besley.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
