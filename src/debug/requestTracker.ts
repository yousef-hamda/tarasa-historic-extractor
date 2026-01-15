/**
 * Request Tracker
 * Tracks all HTTP requests for debugging and performance analysis
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { RequestLog } from './types';
import { debugEventEmitter } from './eventEmitter';

// Request storage
const MAX_REQUESTS = 1000;
const requestLogs: RequestLog[] = [];

// Performance metrics
const routeMetrics: Map<
  string,
  {
    count: number;
    totalTime: number;
    minTime: number;
    maxTime: number;
    errors: number;
  }
> = new Map();

/**
 * Generate unique request ID
 */
const generateRequestId = (): string => {
  return crypto.randomBytes(12).toString('hex');
};

/**
 * Express middleware for tracking requests
 */
export const requestTrackerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = process.hrtime.bigint();
  const requestId = generateRequestId();

  // Attach request ID for reference
  (req as Request & { debugId: string }).debugId = requestId;

  // Override end function to capture response
  const originalEndFn = res.end.bind(res);
  (res as any).end = function (...args: any[]): any {
    const endTime = process.hrtime.bigint();
    const responseTime = Number(endTime - startTime) / 1e6; // Convert to ms

    // Create request log
    const log: RequestLog = {
      id: requestId,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      responseTime,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.socket.remoteAddress,
      query: Object.keys(req.query).length > 0 ? (req.query as Record<string, string>) : undefined,
    };

    // Don't log body for security reasons unless in debug mode
    if (process.env.DEBUG_LOG_BODY === 'true' && req.body && Object.keys(req.body).length > 0) {
      // Sanitize sensitive fields
      const sanitizedBody = { ...req.body };
      ['password', 'token', 'apiKey', 'secret'].forEach((field) => {
        if (sanitizedBody[field]) {
          sanitizedBody[field] = '[REDACTED]';
        }
      });
      log.body = sanitizedBody;
    }

    // Add error if status >= 400
    if (res.statusCode >= 400) {
      log.error = res.statusMessage || 'Error';
    }

    // Store log
    addRequestLog(log);

    // Update route metrics
    updateRouteMetrics(log);

    // Emit event for real-time updates
    debugEventEmitter.emit('request', log);

    // Call original end
    return originalEndFn(...args);
  };

  next();
};

/**
 * Add request log to storage
 */
const addRequestLog = (log: RequestLog): void => {
  requestLogs.push(log);

  // Trim old logs
  while (requestLogs.length > MAX_REQUESTS) {
    requestLogs.shift();
  }
};

/**
 * Update route performance metrics
 */
const updateRouteMetrics = (log: RequestLog): void => {
  const key = `${log.method}:${log.path}`;
  const existing = routeMetrics.get(key) || {
    count: 0,
    totalTime: 0,
    minTime: Infinity,
    maxTime: 0,
    errors: 0,
  };

  existing.count++;
  existing.totalTime += log.responseTime;
  existing.minTime = Math.min(existing.minTime, log.responseTime);
  existing.maxTime = Math.max(existing.maxTime, log.responseTime);
  if (log.statusCode >= 400) {
    existing.errors++;
  }

  routeMetrics.set(key, existing);
};

/**
 * Get recent request logs
 */
export const getRecentRequests = (limit = 100, filter?: { method?: string; path?: string; minStatus?: number }): RequestLog[] => {
  let filtered = [...requestLogs];

  if (filter) {
    if (filter.method) {
      const method = filter.method;
      filtered = filtered.filter((r) => r.method === method);
    }
    if (filter.path) {
      const pathFilter = filter.path;
      filtered = filtered.filter((r) => r.path.includes(pathFilter));
    }
    if (filter.minStatus !== undefined) {
      const minStatus = filter.minStatus;
      filtered = filtered.filter((r) => r.statusCode >= minStatus);
    }
  }

  return filtered.slice(-limit);
};

/**
 * Get request by ID
 */
export const getRequestById = (id: string): RequestLog | undefined => {
  return requestLogs.find((r) => r.id === id);
};

/**
 * Get route performance metrics
 */
export const getRouteMetrics = (): Array<{
  route: string;
  method: string;
  path: string;
  count: number;
  avgTime: number;
  minTime: number;
  maxTime: number;
  errorRate: number;
}> => {
  return Array.from(routeMetrics.entries())
    .map(([key, metrics]) => {
      const [method, path] = key.split(':');
      return {
        route: key,
        method,
        path,
        count: metrics.count,
        avgTime: metrics.totalTime / metrics.count,
        minTime: metrics.minTime === Infinity ? 0 : metrics.minTime,
        maxTime: metrics.maxTime,
        errorRate: (metrics.errors / metrics.count) * 100,
      };
    })
    .sort((a, b) => b.count - a.count);
};

/**
 * Get slow requests
 */
export const getSlowRequests = (thresholdMs = 1000): RequestLog[] => {
  return requestLogs.filter((r) => r.responseTime > thresholdMs).slice(-50);
};

/**
 * Get failed requests
 */
export const getFailedRequests = (limit = 50): RequestLog[] => {
  return requestLogs.filter((r) => r.statusCode >= 400).slice(-limit);
};

/**
 * Get request statistics
 */
export const getRequestStats = (
  minutes = 5
): {
  totalRequests: number;
  requestsPerMinute: number;
  avgResponseTime: number;
  errorRate: number;
  statusCodeDistribution: Record<string, number>;
} => {
  const cutoff = Date.now() - minutes * 60 * 1000;
  const recentRequests = requestLogs.filter((r) => new Date(r.timestamp).getTime() > cutoff);

  const statusDistribution: Record<string, number> = {};
  let totalTime = 0;
  let errors = 0;

  recentRequests.forEach((r) => {
    const statusGroup = `${Math.floor(r.statusCode / 100)}xx`;
    statusDistribution[statusGroup] = (statusDistribution[statusGroup] || 0) + 1;
    totalTime += r.responseTime;
    if (r.statusCode >= 400) errors++;
  });

  return {
    totalRequests: recentRequests.length,
    requestsPerMinute: recentRequests.length / minutes,
    avgResponseTime: recentRequests.length > 0 ? totalTime / recentRequests.length : 0,
    errorRate: recentRequests.length > 0 ? (errors / recentRequests.length) * 100 : 0,
    statusCodeDistribution: statusDistribution,
  };
};

/**
 * Clear request logs (for maintenance)
 */
export const clearRequestLogs = (): void => {
  requestLogs.length = 0;
  routeMetrics.clear();
};
