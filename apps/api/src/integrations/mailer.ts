import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";

export interface Mailer {
  readonly configured: boolean;
  send(to: string[], subject: string, text: string): Promise<void>;
}

class SmtpMailer implements Mailer {
  readonly configured = true;
  private transport: Transporter;
  constructor() {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      requireTLS: env.SMTP_PORT !== 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }
  async send(to: string[], subject: string, text: string) {
    if (to.length === 0) return;
    await this.transport.sendMail({ from: env.SMTP_FROM, to, subject, text });
  }
}

class DisabledMailer implements Mailer {
  readonly configured = false;
  async send() {
    /* SMTP is not configured; in-app notifications are still delivered. */
  }
}

export const mailer: Mailer = env.SMTP_HOST ? new SmtpMailer() : new DisabledMailer();
