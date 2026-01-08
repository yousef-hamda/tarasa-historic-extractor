import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { validateEnv } from './config/env';
import postsRouter from './routes/posts';
import logsRouter from './routes/logs';
import messagesRouter from './routes/messages';
import healthRouter from './routes/health';
import settingsRouter from './routes/settings';
import statsRouter from './routes/stats';
import sessionRouter from './routes/session';
import logger from './utils/logger';
import './cron';
import { errorHandler } from './middleware/errorHandler';
import { apiRateLimiter } from './middleware/rateLimiter';
import { disconnectDatabase } from './database/prisma';

// Validate environment variables before starting
validateEnv();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((o) => o.trim());
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());
app.use(apiRateLimiter);
app.use(postsRouter);
app.use(messagesRouter);
app.use(logsRouter);
app.use(healthRouter);
app.use(settingsRouter);
app.use(statsRouter);
app.use(sessionRouter);
app.use(errorHandler);

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
  logger.info(`API listening on port ${port}`);
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

  // Stop accepting new connections
  server.close(async (err) => {
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
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack || '');
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  gracefulShutdown('unhandledRejection');
});
