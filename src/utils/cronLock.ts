import logger from './logger';
import { getRedisClient, isRedisAvailable } from '../config/redis';

/**
 * Distributed lock system for cron jobs.
 * Uses Redis when available for multi-process safety.
 * Falls back to in-memory locks for single-process deployments.
 */

// In-memory fallback locks
const memoryLocks: Record<string, boolean> = {};
const memoryLockTimestamps: Record<string, number> = {};

// Lock TTL in seconds (prevents deadlocks if process crashes)
const LOCK_TTL_SECONDS = 1800; // 30 minutes to accommodate long classification batches

/**
 * Acquire a distributed lock using Redis SETNX
 */
const acquireRedisLock = async (jobName: string): Promise<boolean> => {
  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) {
    return false; // Signal to use memory lock
  }

  const lockKey = `cron:lock:${jobName}`;
  try {
    // SETNX with TTL - atomic operation
    const result = await redis.set(lockKey, Date.now().toString(), 'EX', LOCK_TTL_SECONDS, 'NX');
    if (result === 'OK') {
      logger.debug(`[DistributedLock] Acquired Redis lock for ${jobName}`);
      return true;
    }
    logger.warn(`[DistributedLock] ${jobName} is already running (Redis lock exists)`);
    return false;
  } catch (error) {
    logger.warn(`[DistributedLock] Redis lock error for ${jobName}: ${(error as Error).message}`);
    return false; // Signal to use memory lock
  }
};

/**
 * Release a distributed lock
 */
const releaseRedisLock = async (jobName: string): Promise<void> => {
  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) {
    return;
  }

  const lockKey = `cron:lock:${jobName}`;
  try {
    await redis.del(lockKey);
    logger.debug(`[DistributedLock] Released Redis lock for ${jobName}`);
  } catch (error) {
    logger.warn(`[DistributedLock] Failed to release Redis lock for ${jobName}: ${(error as Error).message}`);
  }
};

/**
 * Acquire lock (tries Redis first, falls back to memory)
 */
export const acquireLock = async (jobName: string): Promise<boolean> => {
  // Try Redis first for distributed locking
  if (isRedisAvailable()) {
    const acquired = await acquireRedisLock(jobName);
    if (acquired) return true;
    // If Redis lock exists (acquired === false), respect it
    return false;
  }

  // Fallback to in-memory lock (single process only)
  if (memoryLocks[jobName]) {
    logger.warn(`${jobName} is already running (in-memory lock), skipping this execution`);
    return false;
  }
  memoryLocks[jobName] = true;
  memoryLockTimestamps[jobName] = Date.now();
  logger.debug(`[MemoryLock] Acquired lock for ${jobName}`);
  return true;
};

/**
 * Release lock
 */
export const releaseLock = async (jobName: string): Promise<void> => {
  // Release Redis lock if available
  if (isRedisAvailable()) {
    await releaseRedisLock(jobName);
  }

  // Always release memory lock too (for consistency)
  memoryLocks[jobName] = false;
  delete memoryLockTimestamps[jobName];
  logger.debug(`[Lock] Released lock for ${jobName}`);
};

/**
 * Wrapper to run a job with lock protection.
 * Ensures lock is always released even if job throws.
 */
export const withLock = async (jobName: string, job: () => Promise<void>): Promise<void> => {
  const acquired = await acquireLock(jobName);
  if (!acquired) {
    return;
  }

  const startTime = Date.now();
  try {
    await job();
    const duration = Date.now() - startTime;
    logger.debug(`[Lock] Job ${jobName} completed in ${duration}ms`);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`[Lock] Job ${jobName} failed after ${duration}ms: ${(error as Error).message}`);
    throw error; // Re-throw so caller can handle
  } finally {
    await releaseLock(jobName);
  }
};

/**
 * Check if a job is currently locked
 */
export const isLocked = async (jobName: string): Promise<boolean> => {
  // Check Redis first
  if (isRedisAvailable()) {
    const redis = getRedisClient();
    if (redis) {
      try {
        const exists = await redis.exists(`cron:lock:${jobName}`);
        return exists === 1;
      } catch {
        // Fall through to memory check
      }
    }
  }

  return memoryLocks[jobName] || false;
};

/**
 * Force release a stuck lock (admin use only)
 */
export const forceReleaseLock = async (jobName: string): Promise<void> => {
  logger.warn(`[Lock] Force releasing lock for ${jobName}`);
  await releaseRedisLock(jobName);
  memoryLocks[jobName] = false;
  delete memoryLockTimestamps[jobName];
};

// Auto-cleanup stale memory locks every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [job, timestamp] of Object.entries(memoryLockTimestamps)) {
    if (now - timestamp > LOCK_TTL_SECONDS * 1000) {
      logger.warn(`[MemoryLock] Auto-releasing stale lock for ${job} (held for ${Math.round((now - timestamp) / 1000)}s)`);
      memoryLocks[job] = false;
      delete memoryLockTimestamps[job];
    }
  }
}, 300000).unref(); // .unref() prevents this timer from keeping the process alive
