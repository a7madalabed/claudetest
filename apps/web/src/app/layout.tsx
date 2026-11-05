import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { headers } from "next/headers";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Ledgerly", template: "%s · Ledgerly" },
  description: "Your money, beautifully organised.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafb" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0f" },
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
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh font-sans">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
