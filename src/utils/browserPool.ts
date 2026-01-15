/**
 * Browser Pool Manager
 *
 * Limits the number of concurrent browser instances to prevent resource exhaustion.
 * Provides queuing for requests when pool is full.
 */

import logger from './logger';

interface PoolOptions {
  maxInstances: number;
  acquireTimeoutMs: number;
}

class BrowserPool {
  private options: PoolOptions;
  private activeCount: number = 0;
  private waitingQueue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(options: Partial<PoolOptions> = {}) {
    const envMaxInstances = Number(process.env.MAX_BROWSER_INSTANCES) || 2;
    this.options = {
      maxInstances: options.maxInstances ?? envMaxInstances,
      acquireTimeoutMs: options.acquireTimeoutMs ?? 60000, // 1 minute default timeout
    };

    logger.info(`[BrowserPool] Initialized with max ${this.options.maxInstances} instances`);
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
   * Execute a function with automatic pool management
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
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
}

// Global browser pool instance
export const browserPool = new BrowserPool();

export default BrowserPool;
