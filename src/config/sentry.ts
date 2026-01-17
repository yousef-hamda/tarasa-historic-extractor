/**
 * Sentry Error Tracking Configuration
 *
 * Provides:
 * - Automatic error capture
 * - Performance monitoring
 * - Release tracking
 * - Environment-aware configuration
 *
 * To enable: Set SENTRY_DSN in .env
 */

import * as Sentry from '@sentry/node';
import logger from '../utils/logger';

const SENTRY_DSN = process.env.SENTRY_DSN;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

let isInitialized = false;

/**
 * Initialize Sentry SDK
 */
export function initSentry(): void {
  if (!SENTRY_DSN) {
    logger.debug('Sentry: DSN not configured, error tracking disabled');
    return;
  }

  if (isInitialized) {
    return;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: NODE_ENV,
      release: `tarasa-extractor@${process.env.npm_package_version || '1.0.0'}`,

      // Performance monitoring
      tracesSampleRate: isProduction ? 0.1 : 1.0, // 10% in prod, 100% in dev

      // Error filtering
      beforeSend(event, hint) {
        // Filter out non-critical errors in production
        const error = hint.originalException as Error;

        if (error?.message) {
          // Don't report expected errors
          const ignoredErrors = [
            'Navigation failed',
            'net::ERR_',
            'Protocol error',
            'Target closed',
            'Session closed',
            'ECONNREFUSED',
          ];

          if (ignoredErrors.some((ignored) => error.message.includes(ignored))) {
            logger.debug(`Sentry: Filtered error - ${error.message}`);
            return null;
          }
        }

        return event;
      },

      // Integrations
      integrations: [
        // HTTP integration for tracing requests
        Sentry.httpIntegration(),
        // Express integration
        Sentry.expressIntegration(),
      ],

      // Don't send PII
      sendDefaultPii: false,

      // Attach stack traces to messages
      attachStacktrace: true,
    });

    isInitialized = true;
    logger.info('Sentry: Error tracking initialized');
  } catch (error) {
    logger.warn(`Sentry: Failed to initialize - ${(error as Error).message}`);
  }
}

/**
 * Check if Sentry is enabled
 */
export function isSentryEnabled(): boolean {
  return isInitialized;
}

/**
 * Capture an exception with context
 */
export function captureException(
  error: Error,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    user?: { id: string; email?: string };
    level?: 'fatal' | 'error' | 'warning' | 'info';
  }
): string | undefined {
  if (!isInitialized) {
    return undefined;
  }

  return Sentry.captureException(error, {
    tags: context?.tags,
    extra: context?.extra,
    user: context?.user,
    level: context?.level || 'error',
  });
}

/**
 * Capture a message with context
 */
export function captureMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' = 'info',
  context?: Record<string, unknown>
): string | undefined {
  if (!isInitialized) {
    return undefined;
  }

  return Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Set user context for error tracking
 */
export function setUser(user: { id: string; email?: string; username?: string } | null): void {
  if (!isInitialized) return;
  Sentry.setUser(user);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  data?: Record<string, unknown>;
}): void {
  if (!isInitialized) return;
  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Start a transaction for performance monitoring
 */
export function startTransaction(name: string, op: string): Sentry.Span | undefined {
  if (!isInitialized) return undefined;
  return Sentry.startInactiveSpan({ name, op });
}

/**
 * Express error handler middleware
 */
export function sentryErrorHandler() {
  return Sentry.expressErrorHandler();
}

/**
 * Express request handler middleware
 * Note: In Sentry SDK v8+, request handling is automatic via expressIntegration()
 * which is added in init(). This function is kept for backwards compatibility
 * but returns a no-op middleware.
 */
export function sentryRequestHandler() {
  // In Sentry SDK v8+, Sentry.Handlers.requestHandler() is deprecated
  // The expressIntegration() handles this automatically
  return (_req: unknown, _res: unknown, next: () => void) => next();
}

/**
 * Flush pending events before shutdown
 */
export async function flushSentry(timeout = 2000): Promise<boolean> {
  if (!isInitialized) return true;
  return Sentry.close(timeout);
}

export default {
  init: initSentry,
  isEnabled: isSentryEnabled,
  captureException,
  captureMessage,
  setUser,
  addBreadcrumb,
  startTransaction,
  errorHandler: sentryErrorHandler,
  flush: flushSentry,
};
