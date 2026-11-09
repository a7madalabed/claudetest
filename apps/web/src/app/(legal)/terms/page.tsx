import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection, legalLink } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Terms" };
// The contact line comes from the environment at request time (lib/legal.ts).
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <LegalPage title="Terms" updated="9 November 2026">
      <p>
        These are the rules for using Ledgerly. By creating an account you agree to them. How we
        handle your data is on the{" "}
        <Link href="/privacy" className={legalLink}>
          privacy page
        </Link>
        .
      </p>

      <LegalSection title="Your account">
        <ul>
          <li>You must give a real email address, and keep your password to yourself.</li>
          <li>
            You are responsible for what happens in your account and in the households you own,
            including who you invite and what role you give them.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What Ledgerly is, and is not">
        <ul>
          <li>
            Ledgerly is a record-keeping tool. It is{" "}
            <strong>not financial, tax or legal advice</strong>, and its figures are only as
            complete as what you and your household enter or import.
          </li>
          <li>
            It does not hold or move money. It never connects to your bank; you add or import the
            entries yourself.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Using it fairly">
        <ul>
          <li>Don&apos;t try to get into other people&apos;s accounts or households.</li>
          <li>
            Don&apos;t overload the service, or probe it for weaknesses without asking us first.
          </li>
          <li>Don&apos;t use it for anything unlawful.</li>
        </ul>
        <p>We may suspend an account that breaks these rules.</p>
      </LegalSection>

      <LegalSection title="Your data is yours">
        <p>
          You can download a copy of your data or delete your account at any time, from{" "}
          <em>Settings → Security</em>. We use your data only to run Ledgerly for you.
        </p>
      </LegalSection>

      <LegalSection title="No guarantees, and limits on our liability">
        <p>
          We work hard to keep Ledgerly correct and available, but it is provided &ldquo;as
          is&rdquo;, without promises that it will always be available or free of mistakes. To the
          extent the law allows, we are not liable for losses that come from using it, such as a
          decision made on a figure that was entered wrongly. Nothing here limits rights that the
          law says cannot be limited.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If these terms change in a way that matters, we will say so in the app before the change
          applies to you.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
