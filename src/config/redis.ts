/**
 * Redis Configuration and Client
 *
 * Provides Redis connection for:
 * - Caching (classified posts, group info)
 * - Rate limiting (rate-limiter-flexible)
 * - Job queues (BullMQ)
 * - Session storage
 *
 * Falls back gracefully if Redis is not available.
 */

import Redis from 'ioredis';
import logger from '../utils/logger';

// Redis connection URL (supports both local and cloud Redis)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

let redisClient: Redis | null = null;
let isConnected = false;

/**
 * Get or create Redis client
 */
export function getRedisClient(): Redis | null {
  if (redisClient) {
    return isConnected ? redisClient : null;
  }

  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      // Reconnect strategy
      retryStrategy(times) {
        if (times > 10) {
          logger.warn('Redis: Max retries reached, giving up');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 200, 2000);
        return delay;
      },
    });

    redisClient.on('connect', () => {
      logger.info('Redis: Connected successfully');
      isConnected = true;
    });

    redisClient.on('error', (err) => {
      logger.warn(`Redis: Connection error - ${err.message}`);
      isConnected = false;
    });

    redisClient.on('close', () => {
      logger.debug('Redis: Connection closed');
      isConnected = false;
    });

    // Attempt connection
    redisClient.connect().catch((err) => {
      logger.warn(`Redis: Initial connection failed - ${err.message}. Caching disabled.`);
      isConnected = false;
    });

    return redisClient;
  } catch (error) {
    logger.warn(`Redis: Failed to create client - ${(error as Error).message}`);
    return null;
  }
}

/**
 * Check if Redis is available
 */
export function isRedisAvailable(): boolean {
  return isConnected && redisClient !== null;
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('Redis: Connection closed gracefully');
    } catch (error) {
      logger.warn(`Redis: Error closing connection - ${(error as Error).message}`);
    }
    redisClient = null;
    isConnected = false;
  }
}

// ============================================
// Caching Utilities
// ============================================

const DEFAULT_TTL = 300; // 5 minutes

/**
 * Get cached value
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!isRedisAvailable()) return null;

  try {
    const value = await redisClient!.get(key);
    if (value) {
      return JSON.parse(value) as T;
    }
    return null;
  } catch (error) {
    logger.debug(`Cache get error for ${key}: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Set cached value with TTL
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds = DEFAULT_TTL): Promise<boolean> {
  if (!isRedisAvailable()) return false;

  try {
    await redisClient!.setex(key, ttlSeconds, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.debug(`Cache set error for ${key}: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Delete cached value
 */
export async function cacheDelete(key: string): Promise<boolean> {
  if (!isRedisAvailable()) return false;

  try {
    await redisClient!.del(key);
    return true;
  } catch (error) {
    logger.debug(`Cache delete error for ${key}: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Delete all keys matching pattern
 */
export async function cacheDeletePattern(pattern: string): Promise<number> {
  if (!isRedisAvailable()) return 0;

  try {
    const keys = await redisClient!.keys(pattern);
    if (keys.length > 0) {
      await redisClient!.del(...keys);
    }
    return keys.length;
  } catch (error) {
    logger.debug(`Cache delete pattern error for ${pattern}: ${(error as Error).message}`);
    return 0;
  }
}

// ============================================
// Cache Key Generators
// ============================================

export const CacheKeys = {
  // Group info cache
  groupInfo: (groupId: string) => `group:info:${groupId}`,
  groupsList: () => 'groups:list',

  // Post cache
  classifiedPost: (postId: number) => `post:classified:${postId}`,
  recentPosts: (groupId: string) => `posts:recent:${groupId}`,

  // Stats cache
  dashboardStats: () => 'stats:dashboard',
  groupStats: (groupId: string) => `stats:group:${groupId}`,

  // Session cache
  sessionHealth: () => 'session:health',

  // Rate limiting
  rateLimit: (ip: string) => `ratelimit:${ip}`,
};

// ============================================
// High-Level Cache Functions
// ============================================

/**
 * Cache function result with automatic key generation
 */
export async function withCache<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds = DEFAULT_TTL
): Promise<T> {
  // Try cache first
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    logger.debug(`Cache hit: ${key}`);
    return cached;
  }

  // Fetch and cache
  logger.debug(`Cache miss: ${key}`);
  const result = await fetchFn();
  await cacheSet(key, result, ttlSeconds);
  return result;
}

/**
 * Invalidate cache when data changes
 */
export async function invalidateCache(keys: string[]): Promise<void> {
  for (const key of keys) {
    await cacheDelete(key);
  }
}

// Aliases for backward compatibility
export const isRedisConnected = isRedisAvailable;
export const closeRedisConnection = closeRedis;

export default {
  getRedisClient,
  isRedisAvailable,
  isRedisConnected,
  closeRedis,
  closeRedisConnection,
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeletePattern,
  withCache,
  invalidateCache,
  CacheKeys,
};
