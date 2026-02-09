/**
 * Comprehensive tests for alerts utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock nodemailer - define mocks inside factory to avoid hoisting issues
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-id' }),
    })),
  },
}));

import logger from '../src/utils/logger';

describe('sendAlertEmail()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('with missing configuration', () => {
    it('should skip sending when SYSTEM_EMAIL_ALERT is not set', async () => {
      delete process.env.SYSTEM_EMAIL_ALERT;
      process.env.SYSTEM_EMAIL_PASSWORD = 'password';

      // Re-import to get fresh module
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SYSTEM_EMAIL_ALERT or SYSTEM_EMAIL_PASSWORD is not configured')
      );
    });

    it('should skip sending when SYSTEM_EMAIL_PASSWORD is not set', async () => {
      process.env.SYSTEM_EMAIL_ALERT = 'test@example.com';
      delete process.env.SYSTEM_EMAIL_PASSWORD;

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SYSTEM_EMAIL_ALERT or SYSTEM_EMAIL_PASSWORD is not configured')
      );
    });

    it('should skip sending when both env vars are missing', async () => {
      delete process.env.SYSTEM_EMAIL_ALERT;
      delete process.env.SYSTEM_EMAIL_PASSWORD;

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should skip when SYSTEM_EMAIL_ALERT is empty string', async () => {
      process.env.SYSTEM_EMAIL_ALERT = '';
      process.env.SYSTEM_EMAIL_PASSWORD = 'password';

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should skip when SYSTEM_EMAIL_PASSWORD is empty string', async () => {
      process.env.SYSTEM_EMAIL_ALERT = 'test@example.com';
      process.env.SYSTEM_EMAIL_PASSWORD = '';

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test Subject', 'Test body');

      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('with valid configuration', () => {
    beforeEach(() => {
      process.env.SYSTEM_EMAIL_ALERT = 'alerts@tarasa.me';
      process.env.SYSTEM_EMAIL_PASSWORD = 'secret-password';
    });

    it('should log success message after sending', async () => {
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Success Test', 'Body');

      expect(logger.info).toHaveBeenCalledWith('Alert email sent: Success Test');
    });

    it('should handle empty subject', async () => {
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('', 'Body with empty subject');

      expect(logger.info).toHaveBeenCalledWith('Alert email sent: ');
    });

    it('should handle empty body', async () => {
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Subject', '');

      expect(logger.info).toHaveBeenCalledWith('Alert email sent: Subject');
    });

    it('should handle long subject', async () => {
      const longSubject = 'A'.repeat(500);
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail(longSubject, 'Body');

      expect(logger.info).toHaveBeenCalledWith(`Alert email sent: ${longSubject}`);
    });

    it('should handle special characters in subject', async () => {
      const specialSubject = 'Alert: <ERROR> & "Warning" [Critical]';
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail(specialSubject, 'Body');

      expect(logger.info).toHaveBeenCalledWith(`Alert email sent: ${specialSubject}`);
    });

    it('should handle unicode in subject', async () => {
      const unicodeSubject = 'Alert: שגיאה - 错误 - エラー';
      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail(unicodeSubject, 'Body');

      expect(logger.info).toHaveBeenCalledWith(`Alert email sent: ${unicodeSubject}`);
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      process.env.SYSTEM_EMAIL_ALERT = 'alerts@tarasa.me';
      process.env.SYSTEM_EMAIL_PASSWORD = 'secret-password';
    });

    it('should handle send failure gracefully', async () => {
      // Mock nodemailer to throw
      const nodemailer = await import('nodemailer');
      vi.mocked(nodemailer.default.createTransport).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error('SMTP connection failed')),
      } as any);

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test', 'Body');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to send alert email: SMTP connection failed')
      );
    });

    it('should not throw when send fails', async () => {
      const nodemailer = await import('nodemailer');
      vi.mocked(nodemailer.default.createTransport).mockReturnValue({
        sendMail: vi.fn().mockRejectedValue(new Error('Network error')),
      } as any);

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await expect(sendAlertEmail('Test', 'Body')).resolves.not.toThrow();
    });
  });

  describe('transporter usage', () => {
    beforeEach(() => {
      process.env.SYSTEM_EMAIL_ALERT = 'alerts@tarasa.me';
      process.env.SYSTEM_EMAIL_PASSWORD = 'secret-password';
    });

    it('should create transporter on first call', async () => {
      const nodemailer = await import('nodemailer');
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
      vi.mocked(nodemailer.default.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test 1', 'Body 1');

      expect(nodemailer.default.createTransport).toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalled();
    });

    it('should send multiple emails successfully', async () => {
      const nodemailer = await import('nodemailer');
      const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-id' });
      vi.mocked(nodemailer.default.createTransport).mockReturnValue({
        sendMail: mockSendMail,
      } as any);

      const { sendAlertEmail } = await import('../src/utils/alerts');
      await sendAlertEmail('Test 1', 'Body 1');
      await sendAlertEmail('Test 2', 'Body 2');
      await sendAlertEmail('Test 3', 'Body 3');

      // Should have logged 3 success messages
      expect(logger.info).toHaveBeenCalledTimes(3);
    });
  });
});

console.log('Alerts test suite loaded');
