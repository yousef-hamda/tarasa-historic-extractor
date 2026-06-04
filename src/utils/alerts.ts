import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import logger from './logger';

type MailTransporter = nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

let transporter: MailTransporter | null = null;

const getTransporter = (): MailTransporter => {
  if (!transporter) {
    // Use explicit host + port 587 (STARTTLS) instead of `service: 'gmail'`.
    // `service: 'gmail'` defaults to port 465 (SMTPS), which Railway and many
    // other cloud providers block on outbound — the TCP connect then hangs
    // forever with no error, and the email request stays pending until the
    // browser aborts. Port 587 is universally reachable.
    //
    // The three timeouts make any SMTP misconfiguration fail in <20s with a
    // descriptive error instead of hanging silently.
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // upgrades to TLS via STARTTLS
      auth: {
        user: process.env.SYSTEM_EMAIL_ALERT,
        pass: process.env.SYSTEM_EMAIL_PASSWORD,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
};

/**
 * Force-recreate the cached transporter. Call this if env vars change at
 * runtime, or after a config edit so the next send picks up new credentials
 * instead of using a stale cached connection.
 */
export const resetMailTransporter = (): void => {
  transporter = null;
};

export const sendAlertEmail = async (subject: string, text: string): Promise<void> => {
  if (!process.env.SYSTEM_EMAIL_ALERT || !process.env.SYSTEM_EMAIL_PASSWORD) {
    logger.warn('SYSTEM_EMAIL_ALERT or SYSTEM_EMAIL_PASSWORD is not configured; skipping alert email');
    return;
  }

  try {
    const mailer = getTransporter();
    await mailer.sendMail({
      from: `Tarasa Alerts <${process.env.SYSTEM_EMAIL_ALERT}>`,
      to: process.env.SYSTEM_EMAIL_ALERT,
      subject,
      text,
    });
    logger.info(`Alert email sent: ${subject}`);
  } catch (error) {
    logger.error(`Failed to send alert email: ${(error as Error).message}`);
  }
};

export interface HtmlEmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
}

/**
 * Send an HTML email to a specific recipient. Unlike `sendAlertEmail`, this
 * variant takes the recipient as an argument (used by the "Send Approved Posts"
 * button), supports an HTML body, and supports attachments. Returns
 * `{ok: true}` on success or `{ok: false, error}` so the caller can surface
 * the SMTP error back to the dashboard.
 */
export const sendHtmlEmail = async (opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: HtmlEmailAttachment[];
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  if (!process.env.SYSTEM_EMAIL_ALERT || !process.env.SYSTEM_EMAIL_PASSWORD) {
    return {
      ok: false,
      error:
        'Email sender not configured on the server. Ask the operator to set SYSTEM_EMAIL_ALERT and SYSTEM_EMAIL_PASSWORD in Railway env.',
    };
  }
  if (!opts.to || typeof opts.to !== 'string') {
    return { ok: false, error: 'No recipient provided.' };
  }
  try {
    const mailer = getTransporter();
    await mailer.sendMail({
      from: `Tarasa <${process.env.SYSTEM_EMAIL_ALERT}>`,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType ?? 'text/plain',
      })),
    });
    logger.info(`HTML email sent to ${opts.to}: ${opts.subject}`);
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to send HTML email to ${opts.to}: ${msg}`);
    return { ok: false, error: msg };
  }
};
