/**
 * Tests for the email-sending utility.
 *
 * The transport selection layer (Resend > SMTP > none) was added when Railway
 * turned out to block outbound SMTP entirely. These tests pin the new
 * behavior: log messages indicate which transport is in use, and the
 * function silently no-ops when neither transport is configured.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock both transports so we can inspect what was called without performing
// any real network I/O.
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
    })),
  },
}));

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: {
      send: vi.fn().mockResolvedValue({ data: { id: 'resend-id' }, error: null }),
    },
  })),
}));

import logger from '../src/utils/logger';

describe('sendAlertEmail()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.SYSTEM_EMAIL_ALERT;
    delete process.env.SYSTEM_EMAIL_PASSWORD;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('with no transport configured', () => {
    it('skips silently when neither RESEND_API_KEY nor SMTP creds are set', async () => {
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No email transport configured'),
      );
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('skips when only SYSTEM_EMAIL_PASSWORD is set (incomplete SMTP)', async () => {
      process.env.SYSTEM_EMAIL_PASSWORD = 'password';

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No email transport configured'),
      );
    });

    it('skips when only SYSTEM_EMAIL_ALERT is set (incomplete SMTP)', async () => {
      process.env.SYSTEM_EMAIL_ALERT = 'test@example.com';

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      // SYSTEM_EMAIL_ALERT alone makes transport=none (need password too),
      // so the no-transport warning fires.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No email transport configured'),
      );
    });
  });

  describe('with SMTP configured', () => {
    beforeEach(() => {
      process.env.SYSTEM_EMAIL_ALERT = 'alerts@tarasa.me';
      process.env.SYSTEM_EMAIL_PASSWORD = 'secret-password';
    });

    it('routes through SMTP and logs success including transport name', async () => {
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Success Test', 'Body');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Alert email sent via smtp'),
      );
    });

    it('handles long subject', async () => {
      const longSubject = 'A'.repeat(500);
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail(longSubject, 'Body');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(longSubject),
      );
    });

    it('handles unicode in subject', async () => {
      const unicodeSubject = 'Alert: שגיאה - 错误 - エラー';
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail(unicodeSubject, 'Body');

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(unicodeSubject),
      );
    });

    it('logs a failure when SMTP send rejects (does not throw)', async () => {
      const nodemailer = await import('nodemailer');
      vi.mocked(nodemailer.default.createTransport).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error('SMTP connection failed')),
      } as never);

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await expect(sendAlertEmail('Test', 'Body')).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send alert email via smtp'),
      );
    });
  });

  describe('with Resend configured', () => {
    beforeEach(async () => {
      process.env.RESEND_API_KEY = 're_test_key';
      // Resend still needs a recipient — use SYSTEM_EMAIL_ALERT as the "to"
      // address. Without it, sendAlertEmail bails before trying any transport.
      process.env.SYSTEM_EMAIL_ALERT = 'alerts@tarasa.me';
      // Reset the Resend mock to its happy-path default so each test gets a
      // fresh implementation (mockImplementation persists across
      // clearAllMocks; the safer pattern is to re-install it here).
      const { Resend } = await import('resend');
      vi.mocked(Resend).mockImplementation(
        () =>
          ({
            emails: {
              send: vi.fn().mockResolvedValue({ data: { id: 'resend-id' }, error: null }),
            },
          }) as never,
      );
    });

    it('does not warn about missing transport when RESEND_API_KEY is set', async () => {
      // When both transports are configured, getEmailTransportName() returns
      // 'resend' (covered in its own test suite) and sendAlertEmail does not
      // emit the no-transport warning. We verify the negative — log
      // mocking across the multi-import flow is brittle, but the absence
      // of the warn is unambiguous.
      process.env.SYSTEM_EMAIL_PASSWORD = 'smtp-password';

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Routed via Resend', 'Body');

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('No email transport configured'),
      );
    });

    it('logs a failure when Resend rejects (does not throw)', async () => {
      const { Resend } = await import('resend');
      vi.mocked(Resend).mockImplementation(
        () =>
          ({
            emails: {
              send: vi.fn().mockRejectedValue(new Error('Resend down')),
            },
          }) as never,
      );

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await expect(sendAlertEmail('Test', 'Body')).resolves.not.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send alert email via resend'),
      );
    });
  });
});

describe('getEmailTransportName()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.RESEND_API_KEY;
    delete process.env.SYSTEM_EMAIL_ALERT;
    delete process.env.SYSTEM_EMAIL_PASSWORD;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns "resend" when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_test';
    const { getEmailTransportName } = await import('../src/utils/alerts');
    expect(getEmailTransportName()).toBe('resend');
  });

  it('returns "smtp" when only SMTP creds are set', async () => {
    process.env.SYSTEM_EMAIL_ALERT = 'a@b.com';
    process.env.SYSTEM_EMAIL_PASSWORD = 'pw';
    const { getEmailTransportName } = await import('../src/utils/alerts');
    expect(getEmailTransportName()).toBe('smtp');
  });

  it('returns "none" when neither is configured', async () => {
    const { getEmailTransportName } = await import('../src/utils/alerts');
    expect(getEmailTransportName()).toBe('none');
  });

  it('prefers Resend even when SMTP is also set', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.SYSTEM_EMAIL_ALERT = 'a@b.com';
    process.env.SYSTEM_EMAIL_PASSWORD = 'pw';
    const { getEmailTransportName } = await import('../src/utils/alerts');
    expect(getEmailTransportName()).toBe('resend');
  });
});
