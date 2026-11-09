import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection, legalLink } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Privacy" };
// The contact line comes from the environment at request time (lib/legal.ts).
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" updated="9 November 2026">
      <p>
        Ledgerly keeps a household&apos;s finances. This page says what it stores about you, why,
        and what you can do about it. It describes how the app actually works today.
      </p>

      <LegalSection title="What we store">
        <ul>
          <li>
            <strong>Your account:</strong> your email address, your name, your time zone, and your
            password as a one-way hash (we cannot read it). If you turn on two-factor sign-in, the
            secret for your authenticator app (encrypted) and your recovery codes (hashed).
          </li>
          <li>
            <strong>What you put in:</strong> accounts and their balances, transactions (including
            those you import from a bank file), categories, budgets, goals, recurring items and
            notes you write.
          </li>
          <li>
            <strong>Households:</strong> everyone in a household can see that household&apos;s data,
            as far as their role allows (owner, editor or viewer), and can see each other&apos;s
            names and email addresses.
          </li>
          <li>
            <strong>Technical records:</strong> each sign-in records the IP address and browser it
            came from, so you can see and end your sessions. Our servers also keep a short, rotating
            log of requests, including IP addresses, to find and fix problems.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Cookies and browser storage">
        <ul>
          <li>
            A <strong>sign-in cookie</strong>. It lasts up to 30 days and ends sooner if you
            don&apos;t use Ledgerly for 14 days.
          </li>
          <li>
            A <strong>known-device cookie</strong>, set after you sign in. It lets us tell your own
            browser from a stranger&apos;s, so that someone guessing your password can&apos;t lock
            you out. It holds a keyed fingerprint of your email address, never your password, and
            lasts a year.
          </li>
          <li>
            Your browser remembers your light or dark theme and the account you last used for a
            transaction, in its own storage on your device.
          </li>
        </ul>
        <p>
          There are no advertising cookies, no analytics and no third-party trackers. Fonts are
          served by Ledgerly itself.
        </p>
      </LegalSection>

      <LegalSection title="Who else handles your data">
        <p>
          The servers where the data lives, the service that delivers our emails (sign-up
          confirmation, password reset, invitations and notifications), and the storage that holds
          encrypted backups. We don&apos;t sell your data and we don&apos;t share it for
          advertising.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <ul>
          <li>
            <strong>Take a copy:</strong> <em>Settings → Security → Download my data</em> gives you
            everything we hold about you, as a file.
          </li>
          <li>
            <strong>Delete your account:</strong> <em>Settings → Security → Delete my account</em>{" "}
            removes it immediately and permanently. If you are the only owner of a household that
            other people use, hand it over first.
          </li>
          <li>
            <strong>Backups:</strong> copies made before you deleted your account are removed as the
            backups age out, normally within 14 days.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Connections are encrypted (HTTPS), passwords are stored only as hashes, backups are
          encrypted before they leave the server, and you can switch on two-factor sign-in. No
          service is perfectly safe; if something happens that affects you, we will tell you.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If this page changes in a way that matters, we will say so in the app. The rules for using
          Ledgerly are on the{" "}
          <Link href="/terms" className={legalLink}>
            terms page
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
