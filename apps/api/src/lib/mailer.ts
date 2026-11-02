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
