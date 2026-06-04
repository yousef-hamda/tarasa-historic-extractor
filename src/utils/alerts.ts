import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { Resend } from 'resend';
import logger from './logger';

type MailTransporter = nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

// ============================================================================
// Email transport selection.
//
// Railway (and most cloud providers) block outbound SMTP on ports 25/465/587
// to prevent spam. After confirming this via the server logs
// ("Email export failed (SMTP): Connection timeout" — nodemailer's 10s
// connectionTimeout firing on smtp.gmail.com:587), we route all dashboard
// emails through Resend, an HTTP-based transactional service that uses
// port 443 (always reachable).
//
// Selection rule:
//   1. If RESEND_API_KEY is set → use Resend. This is the production path.
//   2. Else if SYSTEM_EMAIL_ALERT + SYSTEM_EMAIL_PASSWORD are set → use
//      Gmail SMTP. Useful for local dev or any host where outbound SMTP
//      works.
//   3. Else → return a clear "no email transport configured" error so the
//      UI tells the operator what to set.
// ============================================================================

let resendClient: Resend | null = null;
let smtpTransporter: MailTransporter | null = null;

const isResendConfigured = (): boolean => Boolean(process.env.RESEND_API_KEY);

const isSmtpConfigured = (): boolean =>
  Boolean(process.env.SYSTEM_EMAIL_ALERT && process.env.SYSTEM_EMAIL_PASSWORD);

export const getEmailTransportName = (): 'resend' | 'smtp' | 'none' =>
  isResendConfigured() ? 'resend' : isSmtpConfigured() ? 'smtp' : 'none';

const getResendClient = (): Resend => {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
};

const getSmtpTransporter = (): MailTransporter => {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SYSTEM_EMAIL_ALERT,
        pass: process.env.SYSTEM_EMAIL_PASSWORD,
      },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return smtpTransporter;
};

/**
 * Force-recreate the cached transporters. Call after env-var rotation.
 */
export const resetMailTransporter = (): void => {
  resendClient = null;
  smtpTransporter = null;
};

/**
 * Resolve the "from" address. Resend's onboarding tier only allows sending
 * from `onboarding@resend.dev` without domain verification — that's the
 * default so the operator gets a working send immediately. Once they verify
 * a domain in Resend, they can override via RESEND_FROM_EMAIL.
 */
const getFromAddress = (transport: 'resend' | 'smtp'): string => {
  if (transport === 'resend') {
    return process.env.RESEND_FROM_EMAIL || 'Tarasa <onboarding@resend.dev>';
  }
  return `Tarasa <${process.env.SYSTEM_EMAIL_ALERT}>`;
};

export const sendAlertEmail = async (subject: string, text: string): Promise<void> => {
  const transport = getEmailTransportName();
  if (transport === 'none') {
    logger.warn('No email transport configured (need RESEND_API_KEY or SMTP creds); skipping alert');
    return;
  }
  const to = process.env.SYSTEM_EMAIL_ALERT || process.env.RESEND_FROM_EMAIL;
  if (!to) {
    logger.warn('No alert recipient (set SYSTEM_EMAIL_ALERT); skipping alert');
    return;
  }
  try {
    if (transport === 'resend') {
      await getResendClient().emails.send({
        from: getFromAddress('resend'),
        to: [to],
        subject,
        text,
      });
    } else {
      await getSmtpTransporter().sendMail({
        from: getFromAddress('smtp'),
        to,
        subject,
        text,
      });
    }
    logger.info(`Alert email sent via ${transport}: ${subject}`);
  } catch (error) {
    logger.error(`Failed to send alert email via ${transport}: ${(error as Error).message}`);
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
  const transport = getEmailTransportName();
  if (transport === 'none') {
    return {
      ok: false,
      error:
        'Email sender not configured on the server. Set RESEND_API_KEY in Railway env (recommended — Railway blocks outbound SMTP) OR SYSTEM_EMAIL_ALERT + SYSTEM_EMAIL_PASSWORD for SMTP transport.',
    };
  }
  if (!opts.to || typeof opts.to !== 'string') {
    return { ok: false, error: 'No recipient provided.' };
  }

  try {
    if (transport === 'resend') {
      const { data, error } = await getResendClient().emails.send({
        from: getFromAddress('resend'),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        attachments: opts.attachments?.map((a) => ({
          filename: a.filename,
          // Resend accepts a string (utf-8) or Buffer for `content`.
          content: a.content,
          contentType: a.contentType ?? 'text/plain',
        })),
      });
      if (error) {
        // Resend's typed error has .name + .message; surface both.
        const msg = `${(error as { name?: string }).name ?? 'ResendError'}: ${error.message}`;
        logger.error(`Resend send failed → ${opts.to}: ${msg}`);
        return { ok: false, error: msg };
      }
      logger.info(`HTML email sent via Resend → ${opts.to} (id=${data?.id ?? 'n/a'}): ${opts.subject}`);
      return { ok: true };
    }

    // SMTP fallback (local dev / non-Railway hosts).
    await getSmtpTransporter().sendMail({
      from: getFromAddress('smtp'),
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
    logger.info(`HTML email sent via SMTP → ${opts.to}: ${opts.subject}`);
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to send HTML email via ${transport} → ${opts.to}: ${msg}`);
    return { ok: false, error: msg };
  }
};
