/**
 * Browser Pool Manager
 *
 * Limits the number of concurrent browser instances to prevent resource exhaustion.
 * Provides queuing for requests when pool is full.
 *
 * Features:
 * - Slot-based concurrency limiting
 * - Queue with timeout for waiting requests
 * - Automatic cleanup on timeout
 * - Operation timeout to prevent hanging
 */

import logger from './logger';

interface PoolOptions {
  maxInstances: number;
  acquireTimeoutMs: number;
  operationTimeoutMs: number; // Max time for a single operation
}

class BrowserPool {
  private options: PoolOptions;
  private activeCount: number = 0;
  private waitingQueue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  // Track active operations for forced cleanup
  private activeOperations: Map<string, { startTime: number; timer: NodeJS.Timeout }> = new Map();

  constructor(options: Partial<PoolOptions> = {}) {
    const envMaxInstances = Number(process.env.MAX_BROWSER_INSTANCES) || 2;
    const envOperationTimeout = Number(process.env.BROWSER_OPERATION_TIMEOUT_MS) || 300000; // 5 min default

    this.options = {
      maxInstances: options.maxInstances ?? envMaxInstances,
      acquireTimeoutMs: options.acquireTimeoutMs ?? 60000, // 1 minute default timeout
      operationTimeoutMs: options.operationTimeoutMs ?? envOperationTimeout,
    };

    logger.info(`[BrowserPool] Initialized with max ${this.options.maxInstances} instances, ${this.options.operationTimeoutMs}ms operation timeout`);
  }

  /**
   * Acquire a slot from the pool
   * Returns a release function that MUST be called when done
   */
  async acquire(): Promise<() => void> {
    // If under limit, acquire immediately
    if (this.activeCount < this.options.maxInstances) {
      this.activeCount++;
      logger.debug(`[BrowserPool] Acquired slot (${this.activeCount}/${this.options.maxInstances} active)`);
      return this.createReleaseFunction();
    }

    // Otherwise, wait in queue
    logger.info(`[BrowserPool] Pool full, waiting for available slot...`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove from queue on timeout
        const index = this.waitingQueue.findIndex((item) => item.timer === timer);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
        }
        reject(new Error(`Browser pool acquire timeout after ${this.options.acquireTimeoutMs}ms`));
      }, this.options.acquireTimeoutMs);

      this.waitingQueue.push({
        resolve: () => {
          clearTimeout(timer);
          this.activeCount++;
          logger.debug(`[BrowserPool] Acquired slot from queue (${this.activeCount}/${this.options.maxInstances} active)`);
          resolve(this.createReleaseFunction());
        },
        reject,
        timer,
      });
    });
  }

  /**
   * Create a release function for an acquired slot
   */
  private createReleaseFunction(): () => void {
    let released = false;

    return () => {
      if (released) {
        logger.warn('[BrowserPool] Slot already released, ignoring duplicate release');
        return;
      }

      released = true;
      this.activeCount--;
      logger.debug(`[BrowserPool] Released slot (${this.activeCount}/${this.options.maxInstances} active)`);

      // If there are waiting requests, let the next one proceed
      if (this.waitingQueue.length > 0) {
        const next = this.waitingQueue.shift();
        if (next) {
          next.resolve();
        }
      }
    };
  }

  /**
   * Execute a function with automatic pool management and operation timeout
   * Prevents operations from running forever and blocking the pool
   */
  async execute<T>(fn: () => Promise<T>, operationId?: string): Promise<T> {
    const release = await this.acquire();
    const opId = operationId || `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let operationTimer: NodeJS.Timeout | undefined;

    this.activeOperations.set(opId, {
      startTime: Date.now(),
      timer: undefined as unknown as NodeJS.Timeout,
    });

    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          operationTimer = setTimeout(() => {
            reject(new Error(`[BrowserPool] Operation ${opId} timed out after ${this.options.operationTimeoutMs}ms`));
          }, this.options.operationTimeoutMs);
          const op = this.activeOperations.get(opId);
          if (op) op.timer = operationTimer;
        }),
      ]);
      return result;
    } catch (error) {
      logger.error(`[BrowserPool] Operation ${opId} failed: ${(error as Error).message}`);
      throw error;
    } finally {
      if (operationTimer) clearTimeout(operationTimer);
      const op = this.activeOperations.get(opId);
      if (op?.timer && op.timer !== operationTimer) clearTimeout(op.timer);
      this.activeOperations.delete(opId);
      release();
    }
  }

  /**
   * Get current pool status
   */
  getStatus(): { active: number; waiting: number; max: number } {
    return {
      active: this.activeCount,
      waiting: this.waitingQueue.length,
      max: this.options.maxInstances,
    };
  }

  /**
   * Check if pool has available slots
   */
  hasAvailableSlot(): boolean {
    return this.activeCount < this.options.maxInstances;
  }

  /**
   * Get detailed status including active operations
   */
  getDetailedStatus(): {
    active: number;
    waiting: number;
    max: number;
    activeOperations: Array<{ id: string; durationMs: number }>;
  } {
    const now = Date.now();
    const activeOps = Array.from(this.activeOperations.entries()).map(([id, op]) => ({
      id,
      durationMs: now - op.startTime,
    }));

    return {
      active: this.activeCount,
      waiting: this.waitingQueue.length,
      max: this.options.maxInstances,
      activeOperations: activeOps,
    };
  }

  /**
   * Force clear a stuck operation (for emergency cleanup)
   * WARNING: Use with caution - may leave browser instances orphaned
   */
  forceReleaseStuckOperations(maxAgeMs: number = 600000): number {
    const now = Date.now();
    let released = 0;

    for (const [opId, op] of this.activeOperations.entries()) {
      if (now - op.startTime > maxAgeMs) {
        logger.warn(`[BrowserPool] Force releasing stuck operation ${opId} (age: ${now - op.startTime}ms)`);
        clearTimeout(op.timer);
        this.activeOperations.delete(opId);
        this.activeCount = Math.max(0, this.activeCount - 1);
        released++;

        // Process waiting queue if any
        if (this.waitingQueue.length > 0) {
          const next = this.waitingQueue.shift();
          if (next) {
            next.resolve();
          }
        }
      }
    }

    if (released > 0) {
      logger.info(`[BrowserPool] Force released ${released} stuck operations`);
    }

    return released;
  }
}

// Global browser pool instance
export const browserPool = new BrowserPool();

export default BrowserPool;
