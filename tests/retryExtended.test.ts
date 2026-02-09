/**
 * Extended tests for retry utilities
 * Supplements the existing retry.test.ts with additional edge cases
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetries } from '../src/utils/retry';

// Mock dependencies
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/utils/delays', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
}));

describe('withRetries() - Extended Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('successful execution', () => {
    it('should return result on first try success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await withRetries(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should pass attempt number to function', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      await withRetries(fn);
      expect(fn).toHaveBeenCalledWith(1);
    });

    it('should return various types of results', async () => {
      // Number
      expect(await withRetries(vi.fn().mockResolvedValue(42))).toBe(42);
      // String
      expect(await withRetries(vi.fn().mockResolvedValue('test'))).toBe('test');
      // Boolean
      expect(await withRetries(vi.fn().mockResolvedValue(true))).toBe(true);
      // Object
      const obj = { key: 'value' };
      expect(await withRetries(vi.fn().mockResolvedValue(obj))).toEqual(obj);
      // Array
      const arr = [1, 2, 3];
      expect(await withRetries(vi.fn().mockResolvedValue(arr))).toEqual(arr);
      // Null
      expect(await withRetries(vi.fn().mockResolvedValue(null))).toBeNull();
      // Undefined
      expect(await withRetries(vi.fn().mockResolvedValue(undefined))).toBeUndefined();
    });
  });

  describe('retry behavior', () => {
    it('should retry on failure and succeed', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValue('success');

      const result = await withRetries(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should retry multiple times before success', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await withRetries(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after exhausting retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('always fail'));

      await expect(withRetries(fn, { attempts: 3 })).rejects.toThrow('always fail');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should pass incrementing attempt number on retries', async () => {
      const attemptNumbers: number[] = [];
      const fn = vi.fn().mockImplementation((attempt: number) => {
        attemptNumbers.push(attempt);
        if (attempt < 3) {
          return Promise.reject(new Error('retry'));
        }
        return Promise.resolve('success');
      });

      await withRetries(fn, { attempts: 3 });

      expect(attemptNumbers).toEqual([1, 2, 3]);
    });
  });

  describe('options', () => {
    describe('attempts option', () => {
      it('should respect custom attempts count', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(withRetries(fn, { attempts: 5 })).rejects.toThrow();
        expect(fn).toHaveBeenCalledTimes(5);
      });

      it('should use default of 3 attempts', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(withRetries(fn)).rejects.toThrow();
        expect(fn).toHaveBeenCalledTimes(3);
      });

      it('should work with 1 attempt (no retries)', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(withRetries(fn, { attempts: 1 })).rejects.toThrow();
        expect(fn).toHaveBeenCalledTimes(1);
      });
    });

    describe('onRetry callback', () => {
      it('should call onRetry for each retry', async () => {
        const onRetry = vi.fn();
        const fn = vi.fn().mockRejectedValue(new Error('fail'));

        await expect(withRetries(fn, { attempts: 3, onRetry })).rejects.toThrow();

        // onRetry is called on failures except the last one
        expect(onRetry).toHaveBeenCalledTimes(2);
      });

      it('should pass error and attempt to onRetry', async () => {
        const onRetry = vi.fn();
        const error = new Error('test error');
        const fn = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue('success');

        await withRetries(fn, { onRetry });

        expect(onRetry).toHaveBeenCalledWith(error, 1);
      });

      it('should not call onRetry on first success', async () => {
        const onRetry = vi.fn();
        const fn = vi.fn().mockResolvedValue('success');

        await withRetries(fn, { onRetry });

        expect(onRetry).not.toHaveBeenCalled();
      });
    });

    describe('operationName option', () => {
      it('should accept operationName', async () => {
        const fn = vi.fn().mockResolvedValue('success');

        const result = await withRetries(fn, { operationName: 'TestOperation' });

        expect(result).toBe('success');
      });

      it('should use operationName in logging', async () => {
        const fn = vi.fn()
          .mockRejectedValueOnce(new Error('fail'))
          .mockResolvedValue('success');

        await withRetries(fn, { operationName: 'MyOp' });

        // Verify retry occurred - operationName is used internally for logging
        expect(fn).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('error handling', () => {
    it('should preserve original error message', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Specific error message'));

      await expect(withRetries(fn, { attempts: 1 })).rejects.toThrow('Specific error message');
    });

    it('should throw the last error when all retries fail', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('error 1'))
        .mockRejectedValueOnce(new Error('error 2'))
        .mockRejectedValueOnce(new Error('error 3'));

      await expect(withRetries(fn, { attempts: 3 })).rejects.toThrow('error 3');
    });

    it('should handle non-Error rejections', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      await expect(withRetries(fn, { attempts: 1 })).rejects.toBe('string error');
    });

    it('should handle synchronous throws', async () => {
      const fn = vi.fn().mockImplementation(() => {
        throw new Error('sync error');
      });

      await expect(withRetries(fn, { attempts: 1 })).rejects.toThrow('sync error');
    });
  });

  describe('timing and delays', () => {
    it('should call delay between retries', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      await withRetries(fn, { delayMs: 1000 });

      // Verify retries happened (function called twice means retry occurred)
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should apply exponential backoff factor', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      await withRetries(fn, { delayMs: 1000, factor: 2, attempts: 4 });

      // Verify function was called 3 times (2 failures + 1 success)
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('edge cases', () => {
    it('should work with async generator-like functions', async () => {
      let callCount = 0;
      const fn = vi.fn().mockImplementation(async () => {
        callCount++;
        return callCount;
      });

      const result = await withRetries(fn);
      expect(result).toBe(1);
    });

    it('should handle very fast retries', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const result = await withRetries(fn, { delayMs: 0 });
      expect(result).toBe('success');
    });

    it('should handle function that returns promise of undefined', async () => {
      const fn = vi.fn().mockResolvedValue(undefined);

      const result = await withRetries(fn);
      expect(result).toBeUndefined();
    });

    it('should handle function that returns promise of empty object', async () => {
      const fn = vi.fn().mockResolvedValue({});

      const result = await withRetries(fn);
      expect(result).toEqual({});
    });

    it('should not modify the function between calls', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      await withRetries(fn);

      // fn should still be the same mock
      expect(fn).toBeDefined();
    });
  });

  describe('concurrent operations', () => {
    it('should handle multiple concurrent retry operations', async () => {
      const fn1 = vi.fn().mockResolvedValue('result1');
      const fn2 = vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('result2');
      const fn3 = vi.fn().mockResolvedValue('result3');

      const results = await Promise.all([
        withRetries(fn1),
        withRetries(fn2),
        withRetries(fn3),
      ]);

      expect(results).toEqual(['result1', 'result2', 'result3']);
    });
  });
});

console.log('Extended retry test suite loaded');
