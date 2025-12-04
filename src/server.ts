import express from 'express';
import cors from 'cors';
import createRateLimiter from './middleware/rateLimiter';
import postsRouter from './routes/posts';
import logsRouter from './routes/logs';
import messagesRouter from './routes/messages';
import healthRouter from './routes/health';
import statsRouter from './routes/stats';
import settingsRouter from './routes/settings';
import logger from './utils/logger';
import './cron';
import { errorHandler } from './middleware/errorHandler';
import prisma from './database/prisma';
import { closeFacebookBrowser } from './facebook/session';

const requiredEnvVars = ['FB_EMAIL', 'FB_PASSWORD', 'OPENAI_API_KEY', 'POSTGRES_URL'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    logger.error(`Missing required env var: ${key}`);
    process.exit(1);
  }
}

const app = express();

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

app.use(
  cors({
    origin: process.env.DASHBOARD_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
  })
);
app.use(express.json());

const limiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

app.use(postsRouter);
app.use(messagesRouter);
app.use(logsRouter);
app.use(statsRouter);
app.use(settingsRouter);
app.use(healthRouter);
app.use(errorHandler);

const port = process.env.PORT || 4000;

const server = app.listen(port, () => {
  logger.info(`API listening on port ${port}`);
});

const gracefulShutdown = async (signal: NodeJS.Signals) => {
  logger.info(`${signal} received, shutting down gracefully`);

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();
  await closeFacebookBrowser();

  process.exit(0);
};

['SIGTERM', 'SIGINT'].forEach((signal) => {
  process.on(signal, () => {
    void gracefulShutdown(signal as NodeJS.Signals);
  });
});
