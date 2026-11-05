import { expect } from "@playwright/test";
import { E2E_MAILPIT_URL } from "./env.js";

/*
 * Reading the emails the app really sent (Stage 15). The worker delivers them
 * over SMTP to Mailpit; its JSON API lets a test open the inbox like a user
 * would — so a broken link, a wrong address or a missing email fails the test.
 */

interface Message {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
}

/** Waits for the newest email to `to` whose subject matches, and returns its text. */
export async function waitForEmail(to: string, subject: RegExp, timeoutMs = 15_000) {
  let found: Message | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `${E2E_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
        );
        const { messages } = (await response.json()) as { messages: Message[] };
        found = messages.find((m) => subject.test(m.Subject));
        return Boolean(found);
      },
      { timeout: timeoutMs, message: `an email to ${to} with subject ${subject}` },
    )
    .toBe(true);
  const message = (await (
    await fetch(`${E2E_MAILPIT_URL}/api/v1/message/${found!.ID}`)
  ).json()) as {
    Text: string;
  };
  return message.Text;
}

/** The first link in an email that points at our app. */
export function linkIn(text: string, path: string) {
  const match = new RegExp(`https?://\\S+${path}\\S*`).exec(text);
  expect(match, `a ${path} link in the email`).not.toBeNull();
  // Emails link to APP_URL; open it on the test's own address.
  const url = new URL(match![0]);
  return `${url.pathname}${url.search}`;
}
