/**
 * Comprehensive tests for Browser Pool Manager
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BrowserPool from '../src/utils/browserPool';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('BrowserPool', () => {
  let pool: BrowserPool;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.MAX_BROWSER_INSTANCES;
    delete process.env.BROWSER_OPERATION_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create pool with default options', () => {
      pool = new BrowserPool();
      const status = pool.getStatus();
      expect(status.max).toBe(2); // Default
      expect(status.active).toBe(0);
      expect(status.waiting).toBe(0);
    });

    it('should respect custom maxInstances option', () => {
      pool = new BrowserPool({ maxInstances: 5 });
      const status = pool.getStatus();
      expect(status.max).toBe(5);
    });

    it('should respect custom acquireTimeoutMs option', () => {
      pool = new BrowserPool({ acquireTimeoutMs: 30000 });
      expect(pool).toBeDefined();
    });

    it('should respect custom operationTimeoutMs option', () => {
      pool = new BrowserPool({ operationTimeoutMs: 60000 });
      expect(pool).toBeDefined();
    });

    it('should respect environment variable MAX_BROWSER_INSTANCES', () => {
      process.env.MAX_BROWSER_INSTANCES = '10';
      pool = new BrowserPool();
      const status = pool.getStatus();
      expect(status.max).toBe(10);
    });

    it('should respect environment variable BROWSER_OPERATION_TIMEOUT_MS', () => {
      process.env.BROWSER_OPERATION_TIMEOUT_MS = '120000';
      pool = new BrowserPool();
      expect(pool).toBeDefined();
    });

    it('should use option over environment variable', () => {
      process.env.MAX_BROWSER_INSTANCES = '10';
      pool = new BrowserPool({ maxInstances: 3 });
      const status = pool.getStatus();
      expect(status.max).toBe(3);
    });
  });

  describe('acquire()', () => {
    beforeEach(() => {
      pool = new BrowserPool({ maxInstances: 2, acquireTimeoutMs: 100 });
    });

    it('should acquire slot immediately when pool has capacity', async () => {
      const release = await pool.acquire();
      expect(typeof release).toBe('function');
      const status = pool.getStatus();
      expect(status.active).toBe(1);
    });

    it('should acquire multiple slots up to max', async () => {
      const release1 = await pool.acquire();
      const release2 = await pool.acquire();
      const status = pool.getStatus();
      expect(status.active).toBe(2);
      release1();
      release2();
    });

    it('should release slot correctly', async () => {
      const release = await pool.acquire();
      expect(pool.getStatus().active).toBe(1);
      release();
      expect(pool.getStatus().active).toBe(0);
    });

    it('should handle double release gracefully', async () => {
      const release = await pool.acquire();
      release();
      expect(pool.getStatus().active).toBe(0);
      release(); // Double release
      expect(pool.getStatus().active).toBe(0); // Should not go negative
    });

    it('should queue when pool is full', async () => {
      const release1 = await pool.acquire();
      const release2 = await pool.acquire();

      // Start acquiring third slot (should queue)
      let thirdAcquired = false;
      const thirdPromise = pool.acquire().then((release) => {
        thirdAcquired = true;
        return release;
      });

      expect(pool.getStatus().waiting).toBe(1);
      expect(thirdAcquired).toBe(false);

      // Release one slot
      release1();

      // Wait for the queued acquire to complete
      const release3 = await thirdPromise;
      expect(thirdAcquired).toBe(true);
      expect(pool.getStatus().active).toBe(2);

      release2();
      release3();
    });

    it('should timeout when waiting too long', async () => {
      const release1 = await pool.acquire();
      const release2 = await pool.acquire();

      // Try to acquire third slot (should timeout)
      await expect(pool.acquire()).rejects.toThrow(/timeout/i);

      release1();
      release2();
    });
  });

  describe('execute()', () => {
    beforeEach(() => {
      pool = new BrowserPool({
        maxInstances: 2,
        acquireTimeoutMs: 100,
        operationTimeoutMs: 100,
      });
    });

    it('should execute function and return result', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const result = await pool.execute(fn);
      expect(result).toBe('result');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should release slot after successful execution', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      await pool.execute(fn);
      expect(pool.getStatus().active).toBe(0);
    });

    it('should release slot after failed execution', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      await expect(pool.execute(fn)).rejects.toThrow('fail');
      expect(pool.getStatus().active).toBe(0);
    });

    it('should timeout long-running operations', async () => {
      const fn = vi.fn().mockImplementation(() => new Promise(() => {})); // Never resolves
      await expect(pool.execute(fn)).rejects.toThrow(/timed out/i);
      expect(pool.getStatus().active).toBe(0);
    });

    it('should use custom operation ID when provided', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      await pool.execute(fn, 'custom-op-123');
      expect(fn).toHaveBeenCalled();
    });

    it('should handle multiple concurrent executions', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      const results = await Promise.all([
        pool.execute(fn),
        pool.execute(fn),
      ]);
      expect(results).toEqual(['result', 'result']);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should queue executions beyond pool capacity', async () => {
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      let callOrder: number[] = [];
      let counter = 0;

      const fn = vi.fn().mockImplementation(async () => {
        const myId = ++counter;
        await delay(10);
        callOrder.push(myId);
        return myId;
      });

      // Start 3 executions on pool with max 2
      const results = await Promise.all([
        pool.execute(fn),
        pool.execute(fn),
        pool.execute(fn),
      ]);

      expect(results.length).toBe(3);
    });
  });

  describe('getStatus()', () => {
    beforeEach(() => {
      pool = new BrowserPool({ maxInstances: 3 });
    });

    it('should return correct initial status', () => {
      const status = pool.getStatus();
      expect(status).toEqual({
        active: 0,
        waiting: 0,
        max: 3,
      });
    });

    it('should reflect active slots', async () => {
      const release = await pool.acquire();
      const status = pool.getStatus();
      expect(status.active).toBe(1);
      release();
    });

    it('should reflect waiting count', async () => {
      pool = new BrowserPool({ maxInstances: 1, acquireTimeoutMs: 1000 });
      const release1 = await pool.acquire();

      // Start waiting acquisition
      const waitingPromise = pool.acquire();
      await new Promise(resolve => setTimeout(resolve, 10));

      const status = pool.getStatus();
      expect(status.waiting).toBe(1);

      release1();
      const release2 = await waitingPromise;
      release2();
    });
  });

  describe('hasAvailableSlot()', () => {
    beforeEach(() => {
      pool = new BrowserPool({ maxInstances: 2 });
    });

    it('should return true when pool is empty', () => {
      expect(pool.hasAvailableSlot()).toBe(true);
    });

    it('should return true when pool has capacity', async () => {
      const release = await pool.acquire();
      expect(pool.hasAvailableSlot()).toBe(true);
      release();
    });

    it('should return false when pool is full', async () => {
      const release1 = await pool.acquire();
      const release2 = await pool.acquire();
      expect(pool.hasAvailableSlot()).toBe(false);
      release1();
      release2();
    });

    it('should return true after releasing from full pool', async () => {
      const release1 = await pool.acquire();
      const release2 = await pool.acquire();
      expect(pool.hasAvailableSlot()).toBe(false);
      release1();
      expect(pool.hasAvailableSlot()).toBe(true);
      release2();
    });
  });

  describe('getDetailedStatus()', () => {
    beforeEach(() => {
      pool = new BrowserPool({ maxInstances: 2, operationTimeoutMs: 10000 });
    });

    it('should return detailed status object', () => {
      const status = pool.getDetailedStatus();
      expect(status).toHaveProperty('active');
      expect(status).toHaveProperty('waiting');
      expect(status).toHaveProperty('max');
      expect(status).toHaveProperty('activeOperations');
    });

    it('should show empty activeOperations initially', () => {
      const status = pool.getDetailedStatus();
      expect(status.activeOperations).toEqual([]);
    });

    it('should track active operations during execution', async () => {
      let statusDuringExecution: any;
      const fn = vi.fn().mockImplementation(async () => {
        statusDuringExecution = pool.getDetailedStatus();
        return 'result';
      });

      await pool.execute(fn, 'test-op-1');

      expect(statusDuringExecution.activeOperations.length).toBe(1);
      expect(statusDuringExecution.activeOperations[0].id).toBe('test-op-1');
      expect(statusDuringExecution.activeOperations[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should clear active operations after execution', async () => {
      const fn = vi.fn().mockResolvedValue('result');
      await pool.execute(fn, 'test-op');

      const status = pool.getDetailedStatus();
      expect(status.activeOperations).toEqual([]);
    });
  });

  describe('forceReleaseStuckOperations()', () => {
    beforeEach(() => {
      pool = new BrowserPool({ maxInstances: 2, operationTimeoutMs: 100000 });
    });

    it('should return 0 when no stuck operations', () => {
      const released = pool.forceReleaseStuckOperations();
      expect(released).toBe(0);
    });

    it('should not release operations under maxAge', async () => {
      // Start a long-running operation
      let resolveOp: () => void;
      const opPromise = new Promise<void>(resolve => { resolveOp = resolve; });

      const executePromise = pool.execute(async () => {
        await opPromise;
        return 'done';
      }, 'stuck-op');

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Try to release with high maxAge
      const released = pool.forceReleaseStuckOperations(10000);
      expect(released).toBe(0);

      // Cleanup
      resolveOp!();
      await executePromise;
    });

    it('should release operations over maxAge', async () => {
      // Start a long-running operation
      let resolveOp: () => void;
      const opPromise = new Promise<void>(resolve => { resolveOp = resolve; });

      const executePromise = pool.execute(async () => {
        await opPromise;
        return 'done';
      }, 'stuck-op').catch(() => {});

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 50));

      // Release with low maxAge
      const released = pool.forceReleaseStuckOperations(10);
      expect(released).toBe(1);
      expect(pool.getStatus().active).toBe(0);

      // Cleanup
      resolveOp!();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid acquire/release cycles', async () => {
      pool = new BrowserPool({ maxInstances: 1 });

      for (let i = 0; i < 10; i++) {
        const release = await pool.acquire();
        expect(pool.getStatus().active).toBe(1);
        release();
        expect(pool.getStatus().active).toBe(0);
      }
    });

    it('should handle concurrent acquire from multiple callers', async () => {
      pool = new BrowserPool({ maxInstances: 2, acquireTimeoutMs: 1000 });

      const acquires = await Promise.all([
        pool.acquire(),
        pool.acquire(),
      ]);

      expect(acquires.length).toBe(2);
      expect(pool.getStatus().active).toBe(2);

      acquires.forEach(release => release());
      expect(pool.getStatus().active).toBe(0);
    });

    it('should handle operation that throws synchronously', async () => {
      pool = new BrowserPool({ maxInstances: 2 });

      const fn = vi.fn().mockImplementation(() => {
        throw new Error('sync error');
      });

      await expect(pool.execute(fn)).rejects.toThrow('sync error');
      expect(pool.getStatus().active).toBe(0);
    });

    it('should handle pool with maxInstances of 1', async () => {
      pool = new BrowserPool({ maxInstances: 1, acquireTimeoutMs: 500 });

      const release = await pool.acquire();
      expect(pool.getStatus().active).toBe(1);
      expect(pool.hasAvailableSlot()).toBe(false);

      release();
      expect(pool.getStatus().active).toBe(0);
      expect(pool.hasAvailableSlot()).toBe(true);
    });

    it('should handle execute with undefined return', async () => {
      pool = new BrowserPool({ maxInstances: 2 });

      const fn = vi.fn().mockResolvedValue(undefined);
      const result = await pool.execute(fn);
      expect(result).toBeUndefined();
    });

    it('should handle execute with null return', async () => {
      pool = new BrowserPool({ maxInstances: 2 });

      const fn = vi.fn().mockResolvedValue(null);
      const result = await pool.execute(fn);
      expect(result).toBeNull();
    });
  });
});

console.log('Browser pool test suite loaded');
