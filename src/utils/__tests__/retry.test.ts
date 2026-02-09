import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock delays so tests run instantly
vi.mock('../../utils/delays', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

import { withRetries } from '../../utils/retry';
import { delay } from '../../utils/delays';

describe('withRetries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------- Success path ----------

  it('returns result on first attempt when fn succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await withRetries(fn);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(1);
    // No delay should have been called
    expect(delay).not.toHaveBeenCalled();
  });

  // ---------- Retry then succeed ----------

  it('retries on failure and returns result on subsequent success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockResolvedValue('success');

    const result = await withRetries(fn, { attempts: 4, delayMs: 100 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
    // Two delays should have occurred (after attempt 1 and after attempt 2)
    expect(delay).toHaveBeenCalledTimes(2);
  });

  // ---------- Exhausts all attempts ----------

  it('throws after all attempts are exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));

    await expect(
      withRetries(fn, { attempts: 3, delayMs: 50 }),
    ).rejects.toThrow('always fails');

    expect(fn).toHaveBeenCalledTimes(3);
    // Delays happen between retries: after attempt 1 and attempt 2 (not after the final attempt)
    expect(delay).toHaveBeenCalledTimes(2);
  });

  // ---------- Exponential backoff ----------

  it('applies exponential backoff factor to delay with jitter', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('done');

    await withRetries(fn, { attempts: 3, delayMs: 100, factor: 2 });

    // Delays are called with jitter (0.5x to 1.5x multiplier)
    // First retry: base 100 -> jittered range [50, 150]
    // Second retry: base 200 -> jittered range [100, 300]
    expect(delay).toHaveBeenCalledTimes(2);
    const firstDelay = (delay as ReturnType<typeof vi.fn>).mock.calls[0][0] as number;
    const secondDelay = (delay as ReturnType<typeof vi.fn>).mock.calls[1][0] as number;

    expect(firstDelay).toBeGreaterThanOrEqual(50);
    expect(firstDelay).toBeLessThanOrEqual(150);
    expect(secondDelay).toBeGreaterThanOrEqual(100);
    expect(secondDelay).toBeLessThanOrEqual(300);
  });

  // ---------- onRetry callback ----------

  it('calls onRetry callback with error and attempt number', async () => {
    const onRetry = vi.fn();
    const error1 = new Error('first');
    const error2 = new Error('second');

    const fn = vi
      .fn()
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2)
      .mockResolvedValue('ok');

    await withRetries(fn, { attempts: 3, delayMs: 10, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, error1, 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, error2, 2);
  });

  // ---------- Does NOT call onRetry on the final failed attempt ----------

  it('does not call onRetry on the final failed attempt', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(
      withRetries(fn, { attempts: 2, delayMs: 10, onRetry }),
    ).rejects.toThrow('fail');

    // onRetry is called after failed attempts that will be retried,
    // i.e., only after attempt 1 (not after the final attempt 2)
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });

  // ---------- Default options ----------

  it('defaults to 3 attempts when no options provided', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(withRetries(fn)).rejects.toThrow('fail');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  // ---------- Passes attempt number to fn ----------

  it('passes the current attempt number to fn', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('done');

    await withRetries(fn, { attempts: 3, delayMs: 10 });

    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });

  // ---------- Single attempt (no retries) ----------

  it('does not retry when attempts is 1', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('no retry'));

    await expect(
      withRetries(fn, { attempts: 1 }),
    ).rejects.toThrow('no retry');

    expect(fn).toHaveBeenCalledOnce();
    expect(delay).not.toHaveBeenCalled();
  });
});
