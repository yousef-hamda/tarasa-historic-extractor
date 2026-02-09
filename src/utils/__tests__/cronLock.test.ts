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

// Mock Redis - simulate Redis NOT available so the module uses in-memory locks
vi.mock('../../config/redis', () => ({
  getRedisClient: vi.fn(() => null),
  isRedisAvailable: vi.fn(() => false),
}));

import {
  acquireLock,
  releaseLock,
  withLock,
  isLocked,
  forceReleaseLock,
} from '../../utils/cronLock';

describe('cronLock (in-memory fallback)', () => {
  beforeEach(async () => {
    // Release any lingering locks between tests
    await forceReleaseLock('test-job');
    await forceReleaseLock('another-job');
  });

  // ---------- acquireLock / releaseLock ----------

  it('acquireLock returns true when lock is free', async () => {
    const acquired = await acquireLock('test-job');
    expect(acquired).toBe(true);
  });

  it('acquireLock returns false when lock is already held', async () => {
    await acquireLock('test-job');
    const second = await acquireLock('test-job');
    expect(second).toBe(false);
  });

  it('releaseLock frees the lock so it can be re-acquired', async () => {
    await acquireLock('test-job');
    await releaseLock('test-job');
    const reacquired = await acquireLock('test-job');
    expect(reacquired).toBe(true);
  });

  // ---------- isLocked ----------

  it('isLocked returns false when no lock is held', async () => {
    expect(await isLocked('test-job')).toBe(false);
  });

  it('isLocked returns true when lock is held', async () => {
    await acquireLock('test-job');
    expect(await isLocked('test-job')).toBe(true);
  });

  it('isLocked returns false after lock is released', async () => {
    await acquireLock('test-job');
    await releaseLock('test-job');
    expect(await isLocked('test-job')).toBe(false);
  });

  // ---------- forceReleaseLock ----------

  it('forceReleaseLock clears a held lock', async () => {
    await acquireLock('test-job');
    await forceReleaseLock('test-job');
    expect(await isLocked('test-job')).toBe(false);
  });

  // ---------- withLock ----------

  it('withLock acquires lock, runs job, then releases lock', async () => {
    const job = vi.fn(async () => {});

    await withLock('test-job', job);

    expect(job).toHaveBeenCalledOnce();
    // Lock should be released after job completes
    expect(await isLocked('test-job')).toBe(false);
  });

  it('withLock skips job execution when lock is already held', async () => {
    // Acquire lock externally
    await acquireLock('test-job');

    const job = vi.fn(async () => {});
    await withLock('test-job', job);

    // Job should NOT have been called
    expect(job).not.toHaveBeenCalled();
  });

  it('withLock releases lock even when the job throws', async () => {
    const failingJob = vi.fn(async () => {
      throw new Error('Job failed!');
    });

    await expect(withLock('test-job', failingJob)).rejects.toThrow('Job failed!');

    // Lock must still be released
    expect(await isLocked('test-job')).toBe(false);
  });

  it('independent job names do not interfere with each other', async () => {
    await acquireLock('test-job');

    // A different job name should still be acquirable
    const acquired = await acquireLock('another-job');
    expect(acquired).toBe(true);
  });
});
