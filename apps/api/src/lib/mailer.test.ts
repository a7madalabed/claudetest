import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadEnv } from "../config/env.js";
import { SmtpMailer } from "./mailer.js";

/*
 * Real SMTP, against Mailpit (`pnpm db:up` starts it; CI runs it as a service):
 * the email must actually travel over the wire and arrive.
 */
const SMTP_URL = process.env.TEST_SMTP_URL ?? "smtp://localhost:1025";
const MAILPIT = process.env.TEST_MAILPIT_URL ?? "http://localhost:8025";

/** Messages Mailpit received for one address. */
async function inbox(to: string) {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  const { messages } = (await response.json()) as {
    messages: Array<{ ID: string; MessageID: string; Subject: string }>;
  };
  return messages;
}

describe("SMTP mailer", () => {
  const mailer = new SmtpMailer(SMTP_URL, "Ledgerly <no-reply@ledgerly.test>");
  afterAll(() => mailer.close());

  it("delivers an email over SMTP", async () => {
    const to = `smtp-${randomUUID()}@example.test`;
    await mailer.send({ to, subject: "Hello from the test", text: "It arrived." });

    const [message] = await inbox(to);
    expect(message?.Subject).toBe("Hello from the test");
    const body = (await (await fetch(`${MAILPIT}/api/v1/message/${message!.ID}`)).json()) as {
      Text: string;
      From: { Address: string };
    };
    expect(body.Text).toContain("It arrived.");
    expect(body.From.Address).toBe("no-reply@ledgerly.test");
  });

  it("gives a retried email the same Message-ID, so mail systems can drop the duplicate", async () => {
    const to = `smtp-${randomUUID()}@example.test`;
    const key = randomUUID();
    for (let i = 0; i < 2; i++) {
      await mailer.send({ to, subject: "Once", text: "…" }, { idempotencyKey: key });
    }
    const messages = await inbox(to);
    expect(messages.map((m) => m.MessageID)).toEqual([
      `${key}@ledgerly.test`,
      `${key}@ledgerly.test`,
    ]);
  });
});

describe("mail configuration", () => {
  const production = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://x:y@localhost:5432/z",
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
  };

  it("refuses to start in production without a deliberate mail setting", () => {
    expect(() => loadEnv(production)).toThrow();
    expect(() => loadEnv({ ...production, MAIL_DRIVER: "smtp" })).toThrow(); // no SMTP_URL
    expect(loadEnv({ ...production, MAIL_DRIVER: "smtp", SMTP_URL: SMTP_URL }).MAIL_DRIVER).toBe(
      "smtp",
    );
    expect(loadEnv({ ...production, MAIL_DRIVER: "log" }).MAIL_DRIVER).toBe("log");
    // Docker Compose passes an unset optional variable as an empty string.
    expect(loadEnv({ ...production, MAIL_DRIVER: "log", SMTP_URL: "" }).SMTP_URL).toBeUndefined();
  });

  it("prints email in development by default", () => {
    expect(loadEnv({ ...production, NODE_ENV: "development" }).MAIL_DRIVER).toBe("log");
  });
});
