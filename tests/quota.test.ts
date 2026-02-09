/**
 * Comprehensive tests for Message Quota utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma before importing quota module
vi.mock('../src/database/prisma', () => ({
  default: {
    messageSent: {
      count: vi.fn(),
    },
  },
}));

import prisma from '../src/database/prisma';
import { getDailyMessageUsage, getRemainingMessageQuota } from '../src/utils/quota';

describe('getDailyMessageUsage()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env variable
    delete process.env.MAX_MESSAGES_PER_DAY;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('with default limit', () => {
    it('should return usage object with correct structure', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      const usage = await getDailyMessageUsage();

      expect(usage).toHaveProperty('limit');
      expect(usage).toHaveProperty('sentLast24h');
      expect(usage).toHaveProperty('remaining');
    });

    it('should use default limit of 20', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      const usage = await getDailyMessageUsage();

      expect(usage.limit).toBe(20);
    });

    it('should return remaining = limit when no messages sent', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      const usage = await getDailyMessageUsage();

      expect(usage.sentLast24h).toBe(0);
      expect(usage.remaining).toBe(20);
    });

    it('should calculate remaining correctly', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(5);

      const usage = await getDailyMessageUsage();

      expect(usage.sentLast24h).toBe(5);
      expect(usage.remaining).toBe(15);
    });

    it('should not return negative remaining', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(25);

      const usage = await getDailyMessageUsage();

      expect(usage.remaining).toBe(0);
    });

    it('should query with correct time window', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      await getDailyMessageUsage();

      expect(prisma.messageSent.count).toHaveBeenCalledWith({
        where: {
          sentAt: { gte: expect.any(Date) },
          status: 'sent',
        },
      });

      // Verify the date is approximately 24 hours ago
      const callArgs = vi.mocked(prisma.messageSent.count).mock.calls[0][0];
      const sinceDate = callArgs?.where?.sentAt?.gte as Date;
      const now = new Date();
      const diff = now.getTime() - sinceDate.getTime();

      // Should be approximately 24 hours (with some tolerance)
      expect(diff).toBeGreaterThan(23.9 * 60 * 60 * 1000);
      expect(diff).toBeLessThan(24.1 * 60 * 60 * 1000);
    });
  });

  describe('with custom limit', () => {
    it('should respect MAX_MESSAGES_PER_DAY env variable', async () => {
      process.env.MAX_MESSAGES_PER_DAY = '50';
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      const usage = await getDailyMessageUsage();

      expect(usage.limit).toBe(50);
      expect(usage.remaining).toBe(50);
    });

    it('should handle string conversion from env', async () => {
      process.env.MAX_MESSAGES_PER_DAY = '100';
      vi.mocked(prisma.messageSent.count).mockResolvedValue(30);

      const usage = await getDailyMessageUsage();

      expect(usage.limit).toBe(100);
      expect(usage.remaining).toBe(70);
    });

    it('should handle zero limit', async () => {
      process.env.MAX_MESSAGES_PER_DAY = '0';
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      const usage = await getDailyMessageUsage();

      // Number('0') || 20 returns 20 because 0 is falsy
      // Actual implementation: Number(process.env.MAX_MESSAGES_PER_DAY || 20)
      // which means the || 20 happens on the string, not the number
      // So '0' || 20 = '0', then Number('0') = 0
      expect(usage.limit).toBe(0);
    });

    it('should handle invalid env value gracefully', async () => {
      process.env.MAX_MESSAGES_PER_DAY = 'not-a-number';
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      const usage = await getDailyMessageUsage();

      // Number('not-a-number') = NaN
      // The implementation doesn't handle NaN, so it returns NaN
      expect(usage.limit).toBeNaN();
    });
  });

  describe('edge cases', () => {
    it('should handle exactly at limit', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(20);

      const usage = await getDailyMessageUsage();

      expect(usage.sentLast24h).toBe(20);
      expect(usage.remaining).toBe(0);
    });

    it('should handle over limit', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(30);

      const usage = await getDailyMessageUsage();

      expect(usage.sentLast24h).toBe(30);
      expect(usage.remaining).toBe(0);
    });

    it('should handle large numbers', async () => {
      process.env.MAX_MESSAGES_PER_DAY = '10000';
      vi.mocked(prisma.messageSent.count).mockResolvedValue(5000);

      const usage = await getDailyMessageUsage();

      expect(usage.limit).toBe(10000);
      expect(usage.sentLast24h).toBe(5000);
      expect(usage.remaining).toBe(5000);
    });
  });

  describe('database interaction', () => {
    it('should call prisma.messageSent.count once', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      await getDailyMessageUsage();

      expect(prisma.messageSent.count).toHaveBeenCalledTimes(1);
    });

    it('should filter by status = sent', async () => {
      vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

      await getDailyMessageUsage();

      expect(prisma.messageSent.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: 'sent',
        }),
      });
    });

    it('should handle database error', async () => {
      vi.mocked(prisma.messageSent.count).mockRejectedValue(new Error('DB Error'));

      await expect(getDailyMessageUsage()).rejects.toThrow('DB Error');
    });
  });
});

describe('getRemainingMessageQuota()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAX_MESSAGES_PER_DAY;
  });

  it('should return remaining quota as number', async () => {
    vi.mocked(prisma.messageSent.count).mockResolvedValue(5);

    const remaining = await getRemainingMessageQuota();

    expect(typeof remaining).toBe('number');
    expect(remaining).toBe(15);
  });

  it('should return full quota when no messages sent', async () => {
    vi.mocked(prisma.messageSent.count).mockResolvedValue(0);

    const remaining = await getRemainingMessageQuota();

    expect(remaining).toBe(20);
  });

  it('should return 0 when quota exhausted', async () => {
    vi.mocked(prisma.messageSent.count).mockResolvedValue(20);

    const remaining = await getRemainingMessageQuota();

    expect(remaining).toBe(0);
  });

  it('should return 0 when over quota', async () => {
    vi.mocked(prisma.messageSent.count).mockResolvedValue(25);

    const remaining = await getRemainingMessageQuota();

    expect(remaining).toBe(0);
  });

  it('should respect custom limit', async () => {
    process.env.MAX_MESSAGES_PER_DAY = '100';
    vi.mocked(prisma.messageSent.count).mockResolvedValue(30);

    const remaining = await getRemainingMessageQuota();

    expect(remaining).toBe(70);
  });

  it('should handle database error', async () => {
    vi.mocked(prisma.messageSent.count).mockRejectedValue(new Error('DB Error'));

    await expect(getRemainingMessageQuota()).rejects.toThrow('DB Error');
  });
});

describe('Integration scenarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAX_MESSAGES_PER_DAY;
  });

  it('should provide consistent data between functions', async () => {
    vi.mocked(prisma.messageSent.count).mockResolvedValue(10);

    const usage = await getDailyMessageUsage();

    // Reset mock call count for second call
    vi.mocked(prisma.messageSent.count).mockResolvedValue(10);
    const remaining = await getRemainingMessageQuota();

    expect(usage.remaining).toBe(remaining);
  });

  it('should handle concurrent calls', async () => {
    vi.mocked(prisma.messageSent.count).mockResolvedValue(5);

    const [usage1, usage2, remaining1, remaining2] = await Promise.all([
      getDailyMessageUsage(),
      getDailyMessageUsage(),
      getRemainingMessageQuota(),
      getRemainingMessageQuota(),
    ]);

    expect(usage1.remaining).toBe(15);
    expect(usage2.remaining).toBe(15);
    expect(remaining1).toBe(15);
    expect(remaining2).toBe(15);
  });

  it('should update correctly as messages are sent', async () => {
    // First call - no messages
    vi.mocked(prisma.messageSent.count).mockResolvedValue(0);
    let remaining = await getRemainingMessageQuota();
    expect(remaining).toBe(20);

    // After 5 messages
    vi.mocked(prisma.messageSent.count).mockResolvedValue(5);
    remaining = await getRemainingMessageQuota();
    expect(remaining).toBe(15);

    // After 20 messages (at limit)
    vi.mocked(prisma.messageSent.count).mockResolvedValue(20);
    remaining = await getRemainingMessageQuota();
    expect(remaining).toBe(0);
  });
});

console.log('Quota test suite loaded');
