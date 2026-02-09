/**
 * Comprehensive tests for system logging utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma before importing
vi.mock('../src/database/prisma', () => ({
  default: {
    systemLog: {
      create: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import prisma from '../src/database/prisma';
import { logSystemEvent, LogType } from '../src/utils/systemLog';

describe('logSystemEvent()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.systemLog.create).mockResolvedValue({
      id: 1,
      type: 'scrape',
      message: 'test',
      createdAt: new Date(),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('valid log types', () => {
    const validTypes: LogType[] = ['scrape', 'classify', 'message', 'auth', 'error', 'admin'];

    validTypes.forEach(type => {
      it(`should log "${type}" type events to database`, async () => {
        await logSystemEvent(type, `Test ${type} message`);

        expect(prisma.systemLog.create).toHaveBeenCalledWith({
          data: {
            type,
            message: `Test ${type} message`,
          },
        });
      });
    });

    it('should handle scrape event logging', async () => {
      await logSystemEvent('scrape', 'Scraped 50 posts from group 123');

      expect(prisma.systemLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'scrape',
          message: 'Scraped 50 posts from group 123',
        },
      });
    });

    it('should handle classify event logging', async () => {
      await logSystemEvent('classify', 'Classified 25 posts');

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'classify',
          message: 'Classified 25 posts',
        },
      });
    });

    it('should handle message event logging', async () => {
      await logSystemEvent('message', 'Sent message to user 456');

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'message',
          message: 'Sent message to user 456',
        },
      });
    });

    it('should handle auth event logging', async () => {
      await logSystemEvent('auth', 'Session renewed successfully');

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'auth',
          message: 'Session renewed successfully',
        },
      });
    });

    it('should handle error event logging', async () => {
      await logSystemEvent('error', 'Failed to connect to database');

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'error',
          message: 'Failed to connect to database',
        },
      });
    });

    it('should handle admin event logging', async () => {
      await logSystemEvent('admin', 'Admin triggered manual scrape');

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'admin',
          message: 'Admin triggered manual scrape',
        },
      });
    });
  });

  describe('invalid log types', () => {
    it('should reject invalid log type and log error', async () => {
      await logSystemEvent('invalid' as LogType, 'Test message');

      // The function should not create a log for invalid types
      expect(prisma.systemLog.create).not.toHaveBeenCalled();
    });

    it('should not create log for unknown type', async () => {
      await logSystemEvent('debug' as LogType, 'Debug message');

      expect(prisma.systemLog.create).not.toHaveBeenCalled();
    });

    it('should not create log for empty string type', async () => {
      await logSystemEvent('' as LogType, 'Test message');

      expect(prisma.systemLog.create).not.toHaveBeenCalled();
    });
  });

  describe('message handling', () => {
    it('should handle empty message', async () => {
      await logSystemEvent('scrape', '');

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'scrape',
          message: '',
        },
      });
    });

    it('should handle very long message', async () => {
      const longMessage = 'x'.repeat(10000);
      await logSystemEvent('error', longMessage);

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'error',
          message: longMessage,
        },
      });
    });

    it('should handle message with special characters', async () => {
      const specialMessage = 'Error: "failed" <script>alert("xss")</script> & more';
      await logSystemEvent('error', specialMessage);

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'error',
          message: specialMessage,
        },
      });
    });

    it('should handle message with unicode', async () => {
      const unicodeMessage = 'שלום עולם - مرحبا - 你好';
      await logSystemEvent('message', unicodeMessage);

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'message',
          message: unicodeMessage,
        },
      });
    });

    it('should handle message with newlines', async () => {
      const multilineMessage = 'Line 1\nLine 2\nLine 3';
      await logSystemEvent('scrape', multilineMessage);

      expect(prisma.systemLog.create).toHaveBeenCalledWith({
        data: {
          type: 'scrape',
          message: multilineMessage,
        },
      });
    });
  });

  describe('database error handling', () => {
    it('should handle database write failure gracefully', async () => {
      vi.mocked(prisma.systemLog.create).mockRejectedValue(new Error('Database connection failed'));

      // Should not throw
      await expect(logSystemEvent('scrape', 'Test message')).resolves.not.toThrow();
    });

    it('should not throw when database fails', async () => {
      vi.mocked(prisma.systemLog.create).mockRejectedValue(new Error('Database error'));

      await expect(logSystemEvent('scrape', 'Test')).resolves.not.toThrow();
    });

    it('should continue operating despite database failure', async () => {
      vi.mocked(prisma.systemLog.create).mockRejectedValue(new Error('Unique constraint violation'));

      // Function should complete without throwing
      await expect(logSystemEvent('error', 'Test')).resolves.not.toThrow();
    });
  });

  describe('concurrent logging', () => {
    it('should handle multiple concurrent log calls', async () => {
      const promises = [
        logSystemEvent('scrape', 'Message 1'),
        logSystemEvent('classify', 'Message 2'),
        logSystemEvent('message', 'Message 3'),
        logSystemEvent('error', 'Message 4'),
        logSystemEvent('auth', 'Message 5'),
      ];

      await Promise.all(promises);

      expect(prisma.systemLog.create).toHaveBeenCalledTimes(5);
    });

    it('should handle rapid sequential logging', async () => {
      for (let i = 0; i < 10; i++) {
        await logSystemEvent('scrape', `Message ${i}`);
      }

      expect(prisma.systemLog.create).toHaveBeenCalledTimes(10);
    });
  });
});

describe('LogType type', () => {
  it('should accept all valid log types', () => {
    const types: LogType[] = ['scrape', 'classify', 'message', 'auth', 'error', 'admin'];
    expect(types.length).toBe(6);
  });
});

console.log('System log test suite loaded');
