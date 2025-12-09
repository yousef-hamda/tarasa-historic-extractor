import nodemailer from 'nodemailer';
import logger from './logger';

type MailTransporter = ReturnType<typeof nodemailer.createTransport>;

let transporter: MailTransporter | null = null;

const getTransporter = (): MailTransporter => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.SYSTEM_EMAIL_ALERT,
        pass: process.env.SYSTEM_EMAIL_PASSWORD,
      },
    });
  }
  return transporter;
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
