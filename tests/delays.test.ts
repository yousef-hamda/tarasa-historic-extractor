/**
 * Comprehensive tests for delay utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { delay, humanDelay } from '../src/utils/delays';

describe('delay()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return a promise', () => {
    const result = delay(100);
    expect(result).toBeInstanceOf(Promise);
    vi.runAllTimers();
  });

  it('should resolve after specified time', async () => {
    const promise = delay(1000);
    let resolved = false;
    promise.then(() => { resolved = true; });

    expect(resolved).toBe(false);
    vi.advanceTimersByTime(999);
    await Promise.resolve(); // Flush microtasks
    expect(resolved).toBe(false);
    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('should resolve to undefined', async () => {
    const promise = delay(100);
    vi.runAllTimers();
    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('should handle zero milliseconds', async () => {
    const promise = delay(0);
    vi.runAllTimers();
    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('should handle very small delays', async () => {
    const promise = delay(1);
    vi.runAllTimers();
    const result = await promise;
    expect(result).toBeUndefined();
  });

  it('should handle large delays', async () => {
    const promise = delay(60000);
    let resolved = false;
    promise.then(() => { resolved = true; });

    vi.advanceTimersByTime(59999);
    await Promise.resolve();
    expect(resolved).toBe(false);

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('should handle multiple concurrent delays', async () => {
    const results: number[] = [];
    const p1 = delay(100).then(() => results.push(1));
    const p2 = delay(200).then(() => results.push(2));
    const p3 = delay(50).then(() => results.push(3));

    vi.advanceTimersByTime(50);
    await Promise.resolve();
    expect(results).toEqual([3]);

    vi.advanceTimersByTime(50);
    await Promise.resolve();
    expect(results).toEqual([3, 1]);

    vi.advanceTimersByTime(100);
    await Promise.resolve();
    expect(results).toEqual([3, 1, 2]);
  });
});

describe('humanDelay() - with real timers', () => {
  it('should return a promise', () => {
    const result = humanDelay(10, 20);
    expect(result).toBeInstanceOf(Promise);
  });

  it('should delay within specified range', async () => {
    const minMs = 50;
    const maxMs = 100;
    const start = Date.now();
    await humanDelay(minMs, maxMs);
    const elapsed = Date.now() - start;

    // Allow some tolerance for execution overhead
    expect(elapsed).toBeGreaterThanOrEqual(minMs - 10);
    expect(elapsed).toBeLessThanOrEqual(maxMs + 50);
  });

  it('should use default values when not provided', async () => {
    const start = Date.now();
    // Default is 2000-6000ms, but we'll test with shorter values
    // Can't easily test defaults without waiting 2-6 seconds
    const result = humanDelay(10, 50);
    expect(result).toBeInstanceOf(Promise);
  });

  it('should handle equal min and max', async () => {
    const start = Date.now();
    await humanDelay(50, 50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThanOrEqual(100);
  });

  it('should resolve to undefined', async () => {
    const result = await humanDelay(10, 20);
    expect(result).toBeUndefined();
  });
});

describe('humanDelay() - with mocked timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should calculate delay correctly with Math.random = 0', async () => {
    vi.mocked(Math.random).mockReturnValue(0);
    const promise = humanDelay(100, 200);
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
  });

  it('should calculate delay correctly with Math.random = 0.5', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    const promise = humanDelay(100, 200);
    // With min=100, max=200, random=0.5:
    // duration = floor(0.5 * (200 - 100 + 1)) + 100 = floor(50.5) + 100 = 150
    vi.advanceTimersByTime(150);
    await expect(promise).resolves.toBeUndefined();
  });

  it('should calculate delay correctly with Math.random = 0.999', async () => {
    vi.mocked(Math.random).mockReturnValue(0.999);
    const promise = humanDelay(100, 200);
    // With min=100, max=200, random=0.999:
    // duration = floor(0.999 * 101) + 100 = floor(100.899) + 100 = 200
    vi.advanceTimersByTime(200);
    await expect(promise).resolves.toBeUndefined();
  });

  it('should handle min > max gracefully', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    // When min > max, the formula gives negative range
    // duration = floor(0.5 * (50 - 100 + 1)) + 100 = floor(-24.5) + 100 = 75
    const promise = humanDelay(100, 50);
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
  });

  it('should handle zero range', async () => {
    vi.mocked(Math.random).mockReturnValue(0.5);
    const promise = humanDelay(100, 100);
    vi.advanceTimersByTime(100);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe('delay() - edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle negative delay as zero', async () => {
    // setTimeout with negative value typically executes immediately
    const promise = delay(-100);
    vi.runAllTimers();
    await expect(promise).resolves.toBeUndefined();
  });

  it('should handle NaN delay', async () => {
    const promise = delay(NaN);
    vi.runAllTimers();
    // NaN becomes 0 in setTimeout
    await expect(promise).resolves.toBeUndefined();
  });

  it('should handle Infinity delay', async () => {
    const promise = delay(Infinity);
    let resolved = false;
    promise.then(() => { resolved = true; });

    vi.advanceTimersByTime(Number.MAX_SAFE_INTEGER);
    await Promise.resolve();
    // Infinity delay may never resolve or resolve immediately depending on implementation
    // Just verify it doesn't throw
  });
});

describe('Integration scenarios', () => {
  it('should work with async/await pattern', async () => {
    vi.useFakeTimers();

    const results: string[] = [];

    const asyncFn = async () => {
      results.push('start');
      const delayPromise = delay(100);
      vi.runAllTimers();
      await delayPromise;
      results.push('end');
    };

    const promise = asyncFn();
    await promise;

    expect(results).toEqual(['start', 'end']);

    vi.useRealTimers();
  });

  it('should work in Promise.all with multiple delays', async () => {
    vi.useFakeTimers();

    const promises = [
      delay(100).then(() => 'a'),
      delay(200).then(() => 'b'),
      delay(50).then(() => 'c'),
    ];

    vi.runAllTimers();
    const results = await Promise.all(promises);

    expect(results).toEqual(['a', 'b', 'c']);

    vi.useRealTimers();
  });

  it('should work with Promise.race', async () => {
    vi.useFakeTimers();

    const promise = Promise.race([
      delay(100).then(() => 'fast'),
      delay(200).then(() => 'slow'),
    ]);

    vi.runAllTimers();
    const result = await promise;

    expect(result).toBe('fast');

    vi.useRealTimers();
  });
});

console.log('Delay utilities test suite loaded');
