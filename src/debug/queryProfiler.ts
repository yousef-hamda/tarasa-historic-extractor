/**
 * Database Query Profiler
 * Profiles and monitors database queries for performance analysis
 */

import { QueryProfile } from './types';
import { debugEventEmitter } from './eventEmitter';
import logger from '../utils/logger';
import crypto from 'crypto';

// Query storage
const MAX_QUERIES = 500;
const queryProfiles: QueryProfile[] = [];
const SLOW_QUERY_THRESHOLD = parseInt(process.env.SLOW_QUERY_THRESHOLD || '500'); // ms

/**
 * Generate unique query ID
 */
const generateQueryId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * Determine operation type from query
 */
const getOperationType = (query: string): QueryProfile['operation'] => {
  const q = query.toLowerCase().trim();
  if (q.startsWith('select')) return 'select';
  if (q.startsWith('insert')) return 'insert';
  if (q.startsWith('update')) return 'update';
  if (q.startsWith('delete')) return 'delete';
  return 'raw';
};

/**
 * Extract model name from query
 */
const extractModelName = (query: string): string | undefined => {
  // Try to extract table name from common patterns
  const patterns = [
    /from\s+"?(\w+)"?\s/i,
    /into\s+"?(\w+)"?\s/i,
    /update\s+"?(\w+)"?\s/i,
    /delete\s+from\s+"?(\w+)"?\s/i,
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match) return match[1];
  }

  return undefined;
};

/**
 * Create query profile
 */
const createQueryProfile = (
  query: string,
  duration: number,
  rowsAffected?: number
): QueryProfile => {
  const profile: QueryProfile = {
    id: generateQueryId(),
    timestamp: new Date().toISOString(),
    query: query.substring(0, 1000), // Limit query length
    duration,
    rowsAffected,
    model: extractModelName(query),
    operation: getOperationType(query),
    slow: duration > SLOW_QUERY_THRESHOLD,
  };

  // Store profile
  queryProfiles.push(profile);
  while (queryProfiles.length > MAX_QUERIES) {
    queryProfiles.shift();
  }

  // Emit event for slow queries
  if (profile.slow) {
    debugEventEmitter.emitDebugEvent('database', {
      type: 'slow_query',
      profile,
    });
    logger.warn('Slow query detected', {
      duration: `${duration}ms`,
      operation: profile.operation,
      model: profile.model,
    });
  }

  return profile;
};

/**
 * Get recent query profiles
 */
export const getQueryProfiles = (filter?: {
  operation?: QueryProfile['operation'];
  model?: string;
  slow?: boolean;
  limit?: number;
}): QueryProfile[] => {
  let profiles = [...queryProfiles];

  if (filter) {
    if (filter.operation) {
      profiles = profiles.filter((p) => p.operation === filter.operation);
    }
    if (filter.model) {
      profiles = profiles.filter((p) => p.model === filter.model);
    }
    if (filter.slow !== undefined) {
      profiles = profiles.filter((p) => p.slow === filter.slow);
    }
  }

  const limit = filter?.limit || 100;
  return profiles.slice(-limit);
};

/**
 * Get slow queries
 */
export const getSlowQueries = (limit = 50): QueryProfile[] => {
  return queryProfiles.filter((p) => p.slow).slice(-limit);
};

/**
 * Get query statistics
 */
export const getQueryStats = (): {
  totalQueries: number;
  slowQueries: number;
  avgDuration: number;
  byOperation: Record<string, { count: number; avgDuration: number }>;
  byModel: Record<string, { count: number; avgDuration: number }>;
} => {
  const byOperation: Record<string, { count: number; totalDuration: number }> = {};
  const byModel: Record<string, { count: number; totalDuration: number }> = {};
  let totalDuration = 0;
  let slowCount = 0;

  queryProfiles.forEach((p) => {
    totalDuration += p.duration;
    if (p.slow) slowCount++;

    // By operation
    if (!byOperation[p.operation]) {
      byOperation[p.operation] = { count: 0, totalDuration: 0 };
    }
    byOperation[p.operation].count++;
    byOperation[p.operation].totalDuration += p.duration;

    // By model
    if (p.model) {
      if (!byModel[p.model]) {
        byModel[p.model] = { count: 0, totalDuration: 0 };
      }
      byModel[p.model].count++;
      byModel[p.model].totalDuration += p.duration;
    }
  });

  return {
    totalQueries: queryProfiles.length,
    slowQueries: slowCount,
    avgDuration: queryProfiles.length > 0 ? totalDuration / queryProfiles.length : 0,
    byOperation: Object.fromEntries(
      Object.entries(byOperation).map(([op, data]) => [
        op,
        { count: data.count, avgDuration: data.totalDuration / data.count },
      ])
    ),
    byModel: Object.fromEntries(
      Object.entries(byModel).map(([model, data]) => [
        model,
        { count: data.count, avgDuration: data.totalDuration / data.count },
      ])
    ),
  };
};

/**
 * Clear query profiles
 */
export const clearQueryProfiles = (): void => {
  queryProfiles.length = 0;
};

/**
 * Create Prisma middleware for query profiling
 * Note: This returns a function compatible with Prisma's $use() method
 */
export const createQueryProfilerMiddleware = (): ((params: any, next: (params: any) => Promise<any>) => Promise<any>) => {
  return async (params: any, next: (params: any) => Promise<any>) => {
    const startTime = Date.now();

    try {
      const result = await next(params);
      const duration = Date.now() - startTime;

      // Create a simplified query representation
      const query = `${params.action} ${params.model || 'unknown'}`;
      const rowsAffected =
        Array.isArray(result) ? result.length : typeof result === 'number' ? result : undefined;

      createQueryProfile(query, duration, rowsAffected);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const query = `${params.action} ${params.model || 'unknown'} [ERROR]`;

      createQueryProfile(query, duration);

      throw error;
    }
  };
};

/**
 * Export Prisma event handlers for detailed query logging
 */
export const prismaQueryEventHandler = (e: { query: string; duration: number }): void => {
  createQueryProfile(e.query, e.duration);
};

export const prismaErrorEventHandler = (e: { message: string; timestamp: Date }): void => {
  logger.error('Prisma error', { message: e.message });
  debugEventEmitter.emitDebugEvent('database', {
    type: 'error',
    message: e.message,
    timestamp: e.timestamp,
  });
};
