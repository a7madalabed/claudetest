import { createTransport } from "nodemailer";
import type { Logger } from "pino";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sending email is behind an interface, so the code that decides WHAT to send
 * never knows HOW it's sent. Production plugs in a provider (Postmark, SES,
 * Resend…); development prints emails to the worker's log; tests collect them
 * in memory and assert on them.
 */
export interface Mailer {
  /** `idempotencyKey`: the same key twice = the same email; providers that support it send it once. */
  send(email: Email, options?: { idempotencyKey?: string }): Promise<void>;
}

export class LogMailer implements Mailer {
  constructor(private readonly log: Logger) {}
  async send(email: Email) {
    this.log.info(
      { to: email.to, subject: email.subject },
      `📧 Email (development: not really sent)\n\n${email.text}\n`,
    );
  }
}

export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  async send(email: Email) {
    this.sent.push(email);
  }
}

/**
 * Real delivery over SMTP (Stage 15). Works with every provider and, in
 * development and tests, with Mailpit (docker compose): a local inbox at
 * http://localhost:8025 that catches everything and sends nothing.
 */
export class SmtpMailer implements Mailer {
  private readonly transport: ReturnType<typeof createTransport>;
  private readonly domain: string;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    this.transport = createTransport(url);
    this.domain = /@([^>\s]+)/.exec(from)?.[1] ?? "ledgerly.localhost";
  }

  async send(email: Email, options: { idempotencyKey?: string } = {}) {
    await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      // SMTP has no idempotency keys, but a retried job reusing the same
      // Message-ID lets mail systems (Gmail, for one) collapse the duplicate.
      ...(options.idempotencyKey && {
        messageId: `<${options.idempotencyKey}@${this.domain}>`,
      }),
    });
  }

  close() {
    this.transport.close();
  }
}

/** The mailer the environment asks for. */
export function createMailer(
  env: { MAIL_DRIVER: "log" | "smtp"; SMTP_URL?: string; MAIL_FROM: string },
  log: Logger,
): Mailer {
  return env.MAIL_DRIVER === "smtp"
    ? new SmtpMailer(env.SMTP_URL!, env.MAIL_FROM)
    : new LogMailer(log);
}
