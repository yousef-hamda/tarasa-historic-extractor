import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { validateEnv } from './config/env';
import postsRouter from './routes/posts';
import logsRouter from './routes/logs';
import messagesRouter from './routes/messages';
import healthRouter from './routes/health';
import settingsRouter from './routes/settings';
import statsRouter from './routes/stats';
import sessionRouter from './routes/session';
import groupsRouter from './routes/groups';
import debugRouter from './routes/debug';
import backupRouter from './routes/backup';
import submitRouter from './routes/submit';
import searchRouter from './routes/search';
import promptsRouter from './routes/prompts';
import abTestingRouter from './routes/abTesting';
import logger from './utils/logger';
import './cron';
import { errorHandler } from './middleware/errorHandler';
// apiRateLimiter removed - advancedRateLimiter from security.ts handles all global rate limiting
import { disconnectDatabase } from './database/prisma';

// New security and monitoring imports
import { initSentry, captureException, isSentryEnabled } from './config/sentry';
import { securityHeaders, advancedRateLimiter, sanitizeRequest, getCorsOptions } from './middleware/security';
import { closeRedisConnection, isRedisConnected } from './config/redis';
import { closeAllQueues } from './queues/jobQueue';

// Debug system imports
import {
  initializeWebSocket,
  closeAllConnections,
  requestTrackerMiddleware,
  setupGlobalErrorHandlers,
  trackError
} from './debug';

// Circuit breaker reset on startup
import { resetAllCircuitBreakers, getCircuitBreakerStatus } from './utils/circuitBreaker';

// Validate environment variables before starting
validateEnv();

// Initialize Sentry for error tracking (before anything else)
initSentry();
if (isSentryEnabled()) {
  logger.info('Sentry error tracking initialized');
}

// Setup global error handlers for debug system
setupGlobalErrorHandlers();

const app = express();

// Create HTTP server for WebSocket support
const httpServer = createServer(app);

// Initialize WebSocket server for real-time debug monitoring
const wss = initializeWebSocket(httpServer);
logger.info('Debug WebSocket server initialized');

// Security headers (Helmet.js) - must be first
app.use(securityHeaders);

// CORS configuration with dynamic origin validation
app.use(cors(getCorsOptions()));

// Body parsing with size limits
app.use(express.json({ limit: '1mb' }));

// Request sanitization (prototype pollution protection)
app.use(sanitizeRequest);

// Add request tracking middleware for debugging (before rate limiter)
app.use(requestTrackerMiddleware);

// Advanced rate limiting with Redis backend (falls back to memory if Redis unavailable)
app.use(advancedRateLimiter);

// API Routes
app.use(postsRouter);
app.use(messagesRouter);
app.use(logsRouter);
app.use(healthRouter);
app.use(settingsRouter);
app.use(statsRouter);
app.use(sessionRouter);
app.use(groupsRouter);

// Debug and Backup Routes
app.use(debugRouter);
app.use(backupRouter);

// Search, Prompts, and A/B Testing Routes
app.use(searchRouter);
app.use(promptsRouter);
app.use(abTestingRouter);

// Public Submit Landing Page API (no auth required)
app.use(submitRouter);

// Error handler (must be last)
app.use(errorHandler);

const port = process.env.PORT || 4000;

// Use httpServer instead of app.listen for WebSocket support
httpServer.listen(port, () => {
  logger.info(`API listening on port ${port}`);
  logger.info(`Debug WebSocket available at ws://localhost:${port}/debug/ws`);
  logger.info(`Debug Dashboard API at http://localhost:${port}/api/debug/overview`);
  logger.info(`Backup API at http://localhost:${port}/api/backup/list`);

  // Reset circuit breakers on startup - clears any stale OPEN states
  resetAllCircuitBreakers();
  const cbStatus = getCircuitBreakerStatus();
  logger.info(`Circuit breakers reset: Apify=${cbStatus.apify.state}, OpenAI=${cbStatus.openai.state}`);
});

// Graceful shutdown handling
let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
  if (isShuttingDown) {
    logger.info('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // Stop Telegram bot polling
  try {
    const { stopTelegramPolling } = await import('./utils/telegram');
    stopTelegramPolling();
    logger.info('Telegram bot polling stopped');
  } catch (error) {
    logger.error(`Error stopping Telegram polling: ${(error as Error).message}`);
  }

  // Close WebSocket connections
  try {
    closeAllConnections();
    logger.info('WebSocket connections closed');
  } catch (error) {
    logger.error(`Error closing WebSocket connections: ${(error as Error).message}`);
  }

  // Release all cron locks before shutdown
  try {
    const { forceReleaseLock } = await import('./utils/cronLock');
    const lockNames = ['scrape', 'classify', 'message', 'login-refresh', 'session-check', 'backup', 'log-cleanup'];
    await Promise.all(lockNames.map(name => forceReleaseLock(name)));
    logger.info('All cron locks released');
  } catch (error) {
    logger.error(`Error releasing cron locks: ${(error as Error).message}`);
  }

  // Stop accepting new connections
  httpServer.close(async (err) => {
    if (err) {
      logger.error(`Error closing server: ${err.message}`);
      process.exit(1);
    }

    logger.info('HTTP server closed');

    try {
      // Close BullMQ queues
      await closeAllQueues();
      logger.info('Job queues closed');

      // Close Redis connection
      await closeRedisConnection();
      logger.info('Redis connection closed');

      // Disconnect from database
      await disconnectDatabase();
      logger.info('Database connection closed');

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      captureException(error as Error);
      logger.error(`Error during shutdown: ${(error as Error).message}`);
      process.exit(1);
    }
  });

  // Force shutdown after 30 seconds if graceful shutdown doesn't complete
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  captureException(error);
  trackError(error, 'uncaught', { fatal: true });
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack || '');
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  captureException(error);
  trackError(error, 'unhandled', { type: 'promise_rejection' });
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  gracefulShutdown('unhandledRejection');
});
