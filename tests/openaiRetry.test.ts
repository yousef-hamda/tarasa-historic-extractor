/**
 * Comprehensive tests for OpenAI retry utility
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

// Mock circuit breaker - define the mock functions inside the factory
vi.mock('../src/utils/circuitBreaker', () => ({
  openaiCircuitBreaker: {
    isOpen: vi.fn(() => false),
    execute: vi.fn((fn: () => Promise<unknown>) => fn()),
  },
}));

import { callOpenAIWithRetry, isOpenAIAvailable } from '../src/utils/openaiRetry';
import { openaiCircuitBreaker } from '../src/utils/circuitBreaker';
import logger from '../src/utils/logger';

describe('callOpenAIWithRetry()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(openaiCircuitBreaker.isOpen).mockReturnValue(false);
    vi.mocked(openaiCircuitBreaker.execute).mockImplementation(async (fn) => fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful operations', () => {
    it('should return result on first successful attempt', async () => {
      const operation = vi.fn().mockResolvedValue({ data: 'success' });

      const resultPromise = callOpenAIWithRetry(operation);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toEqual({ data: 'success' });
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should pass through returned value', async () => {
      const expected = { id: 123, choices: [{ text: 'Hello' }] };
      const operation = vi.fn().mockResolvedValue(expected);

      const resultPromise = callOpenAIWithRetry(operation);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toEqual(expected);
    });

    it('should work with different return types', async () => {
      const stringOp = vi.fn().mockResolvedValue('string result');
      const numberOp = vi.fn().mockResolvedValue(42);
      const arrayOp = vi.fn().mockResolvedValue([1, 2, 3]);

      const r1Promise = callOpenAIWithRetry(stringOp);
      await vi.runAllTimersAsync();
      const r1 = await r1Promise;

      const r2Promise = callOpenAIWithRetry(numberOp);
      await vi.runAllTimersAsync();
      const r2 = await r2Promise;

      const r3Promise = callOpenAIWithRetry(arrayOp);
      await vi.runAllTimersAsync();
      const r3 = await r3Promise;

      expect(r1).toBe('string result');
      expect(r2).toBe(42);
      expect(r3).toEqual([1, 2, 3]);
    });
  });

  describe('circuit breaker integration', () => {
    it('should throw when circuit breaker is open', async () => {
      vi.mocked(openaiCircuitBreaker.isOpen).mockReturnValue(true);
      const operation = vi.fn().mockResolvedValue('success');

      await expect(callOpenAIWithRetry(operation)).rejects.toThrow('circuit breaker is open');
      expect(operation).not.toHaveBeenCalled();
    });

    it('should log warning when circuit breaker is open', async () => {
      vi.mocked(openaiCircuitBreaker.isOpen).mockReturnValue(true);
      const operation = vi.fn().mockResolvedValue('success');

      try {
        await callOpenAIWithRetry(operation);
      } catch {
        // Expected
      }

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Circuit breaker is OPEN')
      );
    });

    it('should execute through circuit breaker', async () => {
      const operation = vi.fn().mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(openaiCircuitBreaker.execute).toHaveBeenCalled();
    });
  });

  describe('retry behavior', () => {
    it('should retry on 429 rate limit error', async () => {
      const error = { status: 429, message: 'Rate limited' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success after retry');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success after retry');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 internal server error', async () => {
      const error = { status: 500, message: 'Server error' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should retry on 502 bad gateway', async () => {
      const error = { status: 502, message: 'Bad gateway' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
    });

    it('should retry on 503 service unavailable', async () => {
      const error = { status: 503, message: 'Service unavailable' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
    });

    it('should retry on ECONNRESET', async () => {
      const error = { code: 'ECONNRESET', message: 'Connection reset' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
    });

    it('should retry on ETIMEDOUT', async () => {
      const error = { code: 'ETIMEDOUT', message: 'Timed out' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
    });
  });

  describe('non-retryable errors', () => {
    it('should NOT retry on 400 bad request', async () => {
      const error = { status: 400, message: 'Bad request' };
      const operation = vi.fn().mockRejectedValue(error);

      await expect(callOpenAIWithRetry(operation, 3, 100)).rejects.toEqual(error);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on 401 unauthorized', async () => {
      const error = { status: 401, message: 'Unauthorized' };
      const operation = vi.fn().mockRejectedValue(error);

      await expect(callOpenAIWithRetry(operation, 3, 100)).rejects.toEqual(error);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on generic errors without status', async () => {
      const error = new Error('Generic error');
      const operation = vi.fn().mockRejectedValue(error);

      await expect(callOpenAIWithRetry(operation, 3, 100)).rejects.toThrow('Generic error');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry parameters', () => {
    it('should respect custom retry count', async () => {
      // Use real timers with very short delay for this test
      vi.useRealTimers();

      const error = { status: 429, message: 'Rate limited' };
      const operation = vi.fn().mockRejectedValue(error);

      await expect(callOpenAIWithRetry(operation, 5, 1)).rejects.toEqual(error);

      expect(operation).toHaveBeenCalledTimes(5);

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });
  });

  describe('logging', () => {
    it('should log warning on retry', async () => {
      const error = { status: 429, message: 'Rate limited' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1/3')
      );
    });

    it('should include error message in log', async () => {
      const error = { status: 429, message: 'Too many requests' };
      const operation = vi.fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue('success');

      const resultPromise = callOpenAIWithRetry(operation, 3, 100);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Too many requests')
      );
    });
  });

  describe('exhausted retries', () => {
    it('should throw after all retries exhausted', async () => {
      // Use real timers with very short delay to avoid unhandled rejections
      vi.useRealTimers();

      const error = { status: 429, message: 'Rate limited' };
      const operation = vi.fn().mockRejectedValue(error);

      await expect(callOpenAIWithRetry(operation, 3, 1)).rejects.toEqual(error);
      expect(operation).toHaveBeenCalledTimes(3);

      // Restore fake timers for other tests
      vi.useFakeTimers();
    });
  });
});

describe('isOpenAIAvailable()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when circuit breaker is closed', () => {
    vi.mocked(openaiCircuitBreaker.isOpen).mockReturnValue(false);

    expect(isOpenAIAvailable()).toBe(true);
  });

  it('should return false when circuit breaker is open', () => {
    vi.mocked(openaiCircuitBreaker.isOpen).mockReturnValue(true);

    expect(isOpenAIAvailable()).toBe(false);
  });

  it('should call circuit breaker isOpen', () => {
    isOpenAIAvailable();

    expect(openaiCircuitBreaker.isOpen).toHaveBeenCalled();
  });
});

console.log('OpenAI retry test suite loaded');
