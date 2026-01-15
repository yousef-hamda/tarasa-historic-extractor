/**
 * Advanced Error Tracker
 * Tracks, categorizes, and analyzes errors for the debugging system
 */

import { ErrorLog } from './types';
import { debugEventEmitter } from './eventEmitter';
import logger from '../utils/logger';
import crypto from 'crypto';

// Error storage
const MAX_ERRORS = 500;
const errorLogs: Map<string, ErrorLog> = new Map();
const errorOrder: string[] = [];

/**
 * Generate error fingerprint for deduplication
 */
const generateErrorFingerprint = (type: ErrorLog['type'], message: string, stack?: string): string => {
  const content = `${type}:${message}:${stack?.split('\n')[1] || ''}`;
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 16);
};

/**
 * Determine error type from error object
 */
const categorizeError = (
  error: Error,
  context?: Record<string, unknown>
): ErrorLog['type'] => {
  const message = error.message.toLowerCase();
  const stack = error.stack?.toLowerCase() || '';

  // Database errors
  if (
    message.includes('prisma') ||
    message.includes('database') ||
    message.includes('postgres') ||
    message.includes('connection') ||
    stack.includes('prisma')
  ) {
    return 'database';
  }

  // Scraper errors
  if (
    message.includes('scrape') ||
    message.includes('facebook') ||
    message.includes('playwright') ||
    message.includes('browser') ||
    context?.source === 'scraper'
  ) {
    return 'scraper';
  }

  // AI/OpenAI errors
  if (
    message.includes('openai') ||
    message.includes('gpt') ||
    message.includes('classification') ||
    message.includes('rate limit') ||
    context?.source === 'ai'
  ) {
    return 'ai';
  }

  // Messenger errors
  if (
    message.includes('messenger') ||
    message.includes('message') ||
    message.includes('send') ||
    context?.source === 'messenger'
  ) {
    return 'messenger';
  }

  // Session errors
  if (
    message.includes('session') ||
    message.includes('login') ||
    message.includes('auth') ||
    message.includes('cookie') ||
    context?.source === 'session'
  ) {
    return 'session';
  }

  // API errors
  if (
    message.includes('api') ||
    message.includes('request') ||
    message.includes('response') ||
    context?.source === 'api'
  ) {
    return 'api';
  }

  return 'uncaught';
};

/**
 * Track an error
 */
export const trackError = (
  error: Error | string,
  type?: ErrorLog['type'],
  context?: Record<string, unknown>
): ErrorLog => {
  const errorObj = typeof error === 'string' ? new Error(error) : error;
  const errorType = type || categorizeError(errorObj, context);
  const fingerprint = generateErrorFingerprint(errorType, errorObj.message, errorObj.stack);

  // Check for existing error
  const existing = errorLogs.get(fingerprint);

  if (existing) {
    // Update existing error
    existing.occurrences++;
    existing.lastOccurrence = new Date().toISOString();
    if (context) {
      existing.context = { ...existing.context, ...context };
    }
    debugEventEmitter.emitDebugEvent('error', existing);
    return existing;
  }

  // Create new error log
  const errorLog: ErrorLog = {
    id: fingerprint,
    timestamp: new Date().toISOString(),
    type: errorType,
    message: errorObj.message,
    stack: errorObj.stack,
    context,
    resolved: false,
    occurrences: 1,
    lastOccurrence: new Date().toISOString(),
  };

  // Store error
  errorLogs.set(fingerprint, errorLog);
  errorOrder.push(fingerprint);

  // Trim old errors
  while (errorOrder.length > MAX_ERRORS) {
    const oldId = errorOrder.shift();
    if (oldId) {
      errorLogs.delete(oldId);
    }
  }

  // Emit event
  debugEventEmitter.emitDebugEvent('error', errorLog);

  // Log to winston
  logger.error(`[${errorType}] ${errorObj.message}`, {
    errorId: fingerprint,
    stack: errorObj.stack,
    context,
  });

  return errorLog;
};

/**
 * Track uncaught exception
 */
export const trackUncaughtException = (error: Error): ErrorLog => {
  return trackError(error, 'uncaught', { fatal: true });
};

/**
 * Track unhandled rejection
 */
export const trackUnhandledRejection = (reason: unknown): ErrorLog => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  return trackError(error, 'unhandled', { type: 'promise_rejection' });
};

/**
 * Get all error logs
 */
export const getErrorLogs = (filter?: {
  type?: ErrorLog['type'];
  resolved?: boolean;
  since?: Date;
}): ErrorLog[] => {
  let errors = Array.from(errorLogs.values());

  if (filter) {
    if (filter.type) {
      errors = errors.filter((e) => e.type === filter.type);
    }
    if (filter.resolved !== undefined) {
      errors = errors.filter((e) => e.resolved === filter.resolved);
    }
    if (filter.since) {
      errors = errors.filter((e) => new Date(e.timestamp) >= filter.since!);
    }
  }

  return errors.sort((a, b) => new Date(b.lastOccurrence).getTime() - new Date(a.lastOccurrence).getTime());
};

/**
 * Get error by ID
 */
export const getErrorById = (id: string): ErrorLog | undefined => {
  return errorLogs.get(id);
};

/**
 * Mark error as resolved
 */
export const resolveError = (id: string, resolutionMethod?: string): boolean => {
  const error = errorLogs.get(id);
  if (!error) return false;

  error.resolved = true;
  error.resolvedAt = new Date().toISOString();
  error.resolutionMethod = resolutionMethod;

  debugEventEmitter.emitDebugEvent('error', { ...error, action: 'resolved' });
  return true;
};

/**
 * Get error statistics
 */
export const getErrorStats = (): {
  total: number;
  byType: Record<string, number>;
  resolved: number;
  unresolved: number;
  last24Hours: number;
  mostFrequent: Array<{ message: string; count: number; type: string }>;
} => {
  const errors = Array.from(errorLogs.values());
  const byType: Record<string, number> = {};
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  errors.forEach((e) => {
    byType[e.type] = (byType[e.type] || 0) + e.occurrences;
  });

  const mostFrequent = errors
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 10)
    .map((e) => ({
      message: e.message.substring(0, 100),
      count: e.occurrences,
      type: e.type,
    }));

  return {
    total: errors.reduce((sum, e) => sum + e.occurrences, 0),
    byType,
    resolved: errors.filter((e) => e.resolved).length,
    unresolved: errors.filter((e) => !e.resolved).length,
    last24Hours: errors.filter((e) => new Date(e.lastOccurrence).getTime() > cutoff).reduce((sum, e) => sum + e.occurrences, 0),
    mostFrequent,
  };
};

/**
 * Clear resolved errors
 */
export const clearResolvedErrors = (): number => {
  let cleared = 0;
  errorLogs.forEach((error, id) => {
    if (error.resolved) {
      errorLogs.delete(id);
      const index = errorOrder.indexOf(id);
      if (index > -1) errorOrder.splice(index, 1);
      cleared++;
    }
  });
  return cleared;
};

/**
 * Clear all errors
 */
export const clearAllErrors = (): void => {
  errorLogs.clear();
  errorOrder.length = 0;
};

/**
 * Setup global error handlers
 */
export const setupGlobalErrorHandlers = (): void => {
  process.on('uncaughtException', (error) => {
    trackUncaughtException(error);
  });

  process.on('unhandledRejection', (reason) => {
    trackUnhandledRejection(reason);
  });

  logger.info('Global error handlers installed');
};
