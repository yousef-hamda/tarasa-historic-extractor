/**
 * Comprehensive tests for Circuit Breaker implementation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import CircuitBreaker, {
  apifyCircuitBreaker,
  openaiCircuitBreaker,
  resetAllCircuitBreakers,
  getCircuitBreakerStatus,
} from '../src/utils/circuitBreaker';

// Mock logger and systemLog
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/utils/systemLog', () => ({
  logSystemEvent: vi.fn(),
}));

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    // Create a new breaker with fast timeouts for testing
    breaker = new CircuitBreaker({
      name: 'TestBreaker',
      failureThreshold: 3,
      resetTimeoutMs: 100, // Fast timeout for testing
      halfOpenRequests: 2,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    resetAllCircuitBreakers();
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should not be open initially', () => {
      expect(breaker.isOpen()).toBe(false);
    });
  });

  describe('execute() - Success Path', () => {
    it('should execute function successfully in CLOSED state', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should remain CLOSED after successful execution', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      await breaker.execute(fn);
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should execute multiple successful calls', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      await breaker.execute(fn);
      await breaker.execute(fn);
      await breaker.execute(fn);
      expect(fn).toHaveBeenCalledTimes(3);
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('execute() - Failure Path', () => {
    it('should throw error from failed function', async () => {
      const error = new Error('Test error');
      const fn = vi.fn().mockRejectedValue(error);
      await expect(breaker.execute(fn)).rejects.toThrow('Test error');
    });

    it('should remain CLOSED after fewer failures than threshold', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      try { await breaker.execute(fn); } catch {}
      try { await breaker.execute(fn); } catch {}
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should open circuit after reaching failure threshold', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(fn); } catch {}
      }
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should be open after reaching failure threshold', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(fn); } catch {}
      }
      expect(breaker.isOpen()).toBe(true);
    });
  });

  describe('OPEN State Behavior', () => {
    beforeEach(async () => {
      // Put breaker in OPEN state
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(fn); } catch {}
      }
    });

    it('should fail fast when OPEN', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      await expect(breaker.execute(fn)).rejects.toThrow(/Circuit breaker.*is OPEN/);
      expect(fn).not.toHaveBeenCalled();
    });

    it('should include retry time in error message', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      await expect(breaker.execute(fn)).rejects.toThrow(/Retry in/);
    });

    it('should report isOpen as true', () => {
      expect(breaker.isOpen()).toBe(true);
    });

    it('should report state as OPEN', () => {
      expect(breaker.getState()).toBe('OPEN');
    });
  });

  describe('HALF_OPEN State Transition', () => {
    beforeEach(async () => {
      // Put breaker in OPEN state
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(fn); } catch {}
      }
    });

    it('should transition to HALF_OPEN after timeout', async () => {
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(breaker.isOpen()).toBe(false);
    });

    it('should allow request in HALF_OPEN state', async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
      const fn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should re-open circuit on failure in HALF_OPEN', async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      try { await breaker.execute(fn); } catch {}
      expect(breaker.getState()).toBe('OPEN');
    });

    it('should close circuit after enough successes in HALF_OPEN', async () => {
      await new Promise(resolve => setTimeout(resolve, 150));
      const fn = vi.fn().mockResolvedValue('success');
      await breaker.execute(fn);
      await breaker.execute(fn);
      expect(breaker.getState()).toBe('CLOSED');
    });
  });

  describe('reset()', () => {
    it('should reset breaker to CLOSED from OPEN', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(fn); } catch {}
      }
      expect(breaker.getState()).toBe('OPEN');
      breaker.reset();
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should reset from HALF_OPEN to CLOSED', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(fn); } catch {}
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      breaker.reset();
      expect(breaker.getState()).toBe('CLOSED');
    });

    it('should allow function execution after reset', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        try { await breaker.execute(failFn); } catch {}
      }
      breaker.reset();
      const successFn = vi.fn().mockResolvedValue('success');
      const result = await breaker.execute(successFn);
      expect(result).toBe('success');
    });
  });

  describe('Success Resets Failure Count', () => {
    it('should reset failure count on success', async () => {
      const failFn = vi.fn().mockRejectedValue(new Error('fail'));
      const successFn = vi.fn().mockResolvedValue('success');

      // 2 failures (below threshold)
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}

      // 1 success (resets count)
      await breaker.execute(successFn);

      // 2 more failures (should not open)
      try { await breaker.execute(failFn); } catch {}
      try { await breaker.execute(failFn); } catch {}

      expect(breaker.getState()).toBe('CLOSED');
    });
  });
});

describe('Pre-configured Circuit Breakers', () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
  });

  describe('apifyCircuitBreaker', () => {
    it('should exist and be a CircuitBreaker', () => {
      expect(apifyCircuitBreaker).toBeDefined();
    });

    it('should start in CLOSED state', () => {
      expect(apifyCircuitBreaker.getState()).toBe('CLOSED');
    });

    it('should not be open initially', () => {
      expect(apifyCircuitBreaker.isOpen()).toBe(false);
    });

    it('should execute functions successfully', async () => {
      const fn = vi.fn().mockResolvedValue('apify-result');
      const result = await apifyCircuitBreaker.execute(fn);
      expect(result).toBe('apify-result');
    });
  });

  describe('openaiCircuitBreaker', () => {
    it('should exist and be a CircuitBreaker', () => {
      expect(openaiCircuitBreaker).toBeDefined();
    });

    it('should start in CLOSED state', () => {
      expect(openaiCircuitBreaker.getState()).toBe('CLOSED');
    });

    it('should not be open initially', () => {
      expect(openaiCircuitBreaker.isOpen()).toBe(false);
    });

    it('should execute functions successfully', async () => {
      const fn = vi.fn().mockResolvedValue('openai-result');
      const result = await openaiCircuitBreaker.execute(fn);
      expect(result).toBe('openai-result');
    });
  });
});

describe('resetAllCircuitBreakers()', () => {
  it('should reset both circuit breakers', async () => {
    // Open both breakers
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 5; i++) {
      try { await apifyCircuitBreaker.execute(failFn); } catch {}
    }
    for (let i = 0; i < 10; i++) {
      try { await openaiCircuitBreaker.execute(failFn); } catch {}
    }

    resetAllCircuitBreakers();

    expect(apifyCircuitBreaker.getState()).toBe('CLOSED');
    expect(openaiCircuitBreaker.getState()).toBe('CLOSED');
  });

  it('should not throw when called multiple times', () => {
    expect(() => resetAllCircuitBreakers()).not.toThrow();
    expect(() => resetAllCircuitBreakers()).not.toThrow();
    expect(() => resetAllCircuitBreakers()).not.toThrow();
  });
});

describe('getCircuitBreakerStatus()', () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
  });

  it('should return status object', () => {
    const status = getCircuitBreakerStatus();
    expect(status).toBeDefined();
    expect(typeof status).toBe('object');
  });

  it('should include apify status', () => {
    const status = getCircuitBreakerStatus();
    expect(status.apify).toBeDefined();
    expect(status.apify.state).toBe('CLOSED');
    expect(status.apify.isOpen).toBe(false);
  });

  it('should include openai status', () => {
    const status = getCircuitBreakerStatus();
    expect(status.openai).toBeDefined();
    expect(status.openai.state).toBe('CLOSED');
    expect(status.openai.isOpen).toBe(false);
  });

  it('should reflect OPEN state when breaker is open', async () => {
    const failFn = vi.fn().mockRejectedValue(new Error('fail'));
    for (let i = 0; i < 5; i++) {
      try { await apifyCircuitBreaker.execute(failFn); } catch {}
    }

    const status = getCircuitBreakerStatus();
    expect(status.apify.state).toBe('OPEN');
    expect(status.apify.isOpen).toBe(true);
  });
});

describe('CircuitBreaker Edge Cases', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'EdgeCaseBreaker',
      failureThreshold: 2,
      resetTimeoutMs: 50,
      halfOpenRequests: 1,
    });
  });

  it('should handle synchronous errors in async functions', async () => {
    const fn = vi.fn().mockImplementation(() => {
      throw new Error('sync error');
    });
    await expect(breaker.execute(fn)).rejects.toThrow('sync error');
  });

  it('should handle functions that resolve to undefined', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const result = await breaker.execute(fn);
    expect(result).toBeUndefined();
  });

  it('should handle functions that resolve to null', async () => {
    const fn = vi.fn().mockResolvedValue(null);
    const result = await breaker.execute(fn);
    expect(result).toBeNull();
  });

  it('should handle functions that resolve to empty string', async () => {
    const fn = vi.fn().mockResolvedValue('');
    const result = await breaker.execute(fn);
    expect(result).toBe('');
  });

  it('should handle functions that resolve to zero', async () => {
    const fn = vi.fn().mockResolvedValue(0);
    const result = await breaker.execute(fn);
    expect(result).toBe(0);
  });

  it('should handle functions that resolve to false', async () => {
    const fn = vi.fn().mockResolvedValue(false);
    const result = await breaker.execute(fn);
    expect(result).toBe(false);
  });

  it('should handle functions that resolve to objects', async () => {
    const obj = { key: 'value', nested: { a: 1 } };
    const fn = vi.fn().mockResolvedValue(obj);
    const result = await breaker.execute(fn);
    expect(result).toEqual(obj);
  });

  it('should handle functions that resolve to arrays', async () => {
    const arr = [1, 2, 3, 'test'];
    const fn = vi.fn().mockResolvedValue(arr);
    const result = await breaker.execute(fn);
    expect(result).toEqual(arr);
  });

  it('should handle very fast consecutive calls', async () => {
    const fn = vi.fn().mockResolvedValue('fast');
    const results = await Promise.all([
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
      breaker.execute(fn),
    ]);
    expect(results).toEqual(['fast', 'fast', 'fast', 'fast', 'fast']);
  });

  it('should handle alternating success and failure', async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) {
        return Promise.reject(new Error('even failure'));
      }
      return Promise.resolve('odd success');
    });

    const results: string[] = [];
    for (let i = 0; i < 5; i++) {
      try {
        results.push(await breaker.execute(fn));
      } catch {
        results.push('error');
      }
    }

    expect(results).toEqual(['odd success', 'error', 'odd success', 'error', 'odd success']);
  });
});

console.log('Circuit breaker test suite loaded');
