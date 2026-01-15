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
import logger from './utils/logger';
import './cron';
import { errorHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';
import { disconnectDatabase } from './database/prisma';

// Debug system imports
import {
  initializeWebSocket,
  closeAllConnections,
  requestTrackerMiddleware,
  setupGlobalErrorHandlers,
  trackError
} from './debug';

// Validate environment variables before starting
validateEnv();

// Setup global error handlers for debug system
setupGlobalErrorHandlers();

const app = express();

// Create HTTP server for WebSocket support
const httpServer = createServer(app);

// Initialize WebSocket server for real-time debug monitoring
const wss = initializeWebSocket(httpServer);
logger.info('Debug WebSocket server initialized');

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(',').map((o) => o.trim());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Add request tracking middleware for debugging (before rate limiter)
app.use(requestTrackerMiddleware);

app.use(apiRateLimiter);

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

// Error handler (must be last)
app.use(errorHandler);

const port = process.env.PORT || 4000;

// Use httpServer instead of app.listen for WebSocket support
httpServer.listen(port, () => {
  logger.info(`API listening on port ${port}`);
  logger.info(`Debug WebSocket available at ws://localhost:${port}/debug/ws`);
  logger.info(`Debug Dashboard API at http://localhost:${port}/api/debug/overview`);
  logger.info(`Backup API at http://localhost:${port}/api/backup/list`);
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

  // Close WebSocket connections
  try {
    closeAllConnections();
    logger.info('WebSocket connections closed');
  } catch (error) {
    logger.error(`Error closing WebSocket connections: ${(error as Error).message}`);
  }

  // Stop accepting new connections
  httpServer.close(async (err) => {
    if (err) {
      logger.error(`Error closing server: ${err.message}`);
      process.exit(1);
    }

    logger.info('HTTP server closed');

    try {
      // Disconnect from database
      await disconnectDatabase();
      logger.info('Database connection closed');

      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
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
  trackError(error, 'uncaught', { fatal: true });
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack || '');
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  trackError(error, 'unhandled', { type: 'promise_rejection' });
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  gracefulShutdown('unhandledRejection');
});
