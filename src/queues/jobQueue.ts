/**
 * BullMQ Job Queue System
 *
 * Replaces node-cron with a robust, Redis-backed job queue providing:
 * - Persistent job state (survives restarts)
 * - Automatic retries with exponential backoff
 * - Job priorities and rate limiting
 * - Job dependencies and flows
 * - Real-time monitoring
 * - Dead letter queue for failed jobs
 *
 * Queue Types:
 * - scrape: Facebook group scraping jobs
 * - classify: AI classification jobs
 * - message: Message generation and dispatch jobs
 * - maintenance: Backup, cleanup, session refresh jobs
 */

import { Queue, Worker, Job, QueueEvents, FlowProducer, ConnectionOptions } from 'bullmq';
import { isRedisAvailable } from '../config/redis';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';

// Redis connection URL for BullMQ (uses its own ioredis instance)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// ============================================
// Queue Configuration
// ============================================

const QUEUE_NAMES = {
  SCRAPE: 'scrape',
  CLASSIFY: 'classify',
  MESSAGE: 'message',
  MAINTENANCE: 'maintenance',
} as const;

type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

// Default job options
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000, // 5 seconds initial delay
  },
  removeOnComplete: {
    age: 24 * 3600, // Keep completed jobs for 24 hours
    count: 1000, // Keep last 1000 completed jobs
  },
  removeOnFail: {
    age: 7 * 24 * 3600, // Keep failed jobs for 7 days
  },
};

// Queue-specific configurations
const queueConfigs: Record<QueueName, { concurrency: number; limiter?: { max: number; duration: number } }> = {
  scrape: {
    concurrency: 1, // One scrape at a time to avoid detection
    limiter: { max: 6, duration: 60000 }, // Max 6 scrapes per minute
  },
  classify: {
    concurrency: 2, // Parallel classification batches
    limiter: { max: 20, duration: 60000 }, // Max 20 classifications per minute
  },
  message: {
    concurrency: 1, // Sequential messaging to appear human
    limiter: { max: 5, duration: 60000 }, // Max 5 messages per minute
  },
  maintenance: {
    concurrency: 1,
  },
};

// ============================================
// Queue Instances
// ============================================

const queues: Map<QueueName, Queue> = new Map();
const workers: Map<QueueName, Worker> = new Map();
const queueEvents: Map<QueueName, QueueEvents> = new Map();
let flowProducer: FlowProducer | null = null;

/**
 * Get Redis connection options for BullMQ
 * BullMQ uses its own ioredis instance, so we pass connection options
 */
function getConnection(): ConnectionOptions {
  if (!isRedisAvailable()) {
    throw new Error('Redis not available for job queue');
  }
  // Parse URL for BullMQ connection
  const url = new URL(REDIS_URL);
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    db: parseInt(url.pathname.slice(1)) || 0,
  };
}

/**
 * Create or get a queue
 */
export function getQueue(name: QueueName): Queue | null {
  if (!isRedisAvailable()) {
    logger.warn(`Queue ${name}: Redis not available, falling back to cron`);
    return null;
  }

  if (queues.has(name)) {
    return queues.get(name)!;
  }

  const queue = new Queue(name, {
    connection: getConnection(),
    defaultJobOptions,
  });

  queues.set(name, queue);
  return queue;
}

/**
 * Create a worker for a queue
 */
export function createWorker(
  name: QueueName,
  processor: (job: Job) => Promise<unknown>
): Worker | null {
  if (!isRedisAvailable()) {
    return null;
  }

  const config = queueConfigs[name];

  const worker = new Worker(name, processor, {
    connection: getConnection(),
    concurrency: config.concurrency,
    limiter: config.limiter,
  });

  // Event handlers
  worker.on('completed', (job) => {
    logger.info(`Job ${name}:${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${name}:${job?.id} failed: ${err.message}`);
    logSystemEvent('error', `Job ${name}:${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err) => {
    logger.error(`Worker ${name} error: ${err.message}`);
  });

  workers.set(name, worker);
  return worker;
}

/**
 * Get queue events for monitoring
 */
export function getQueueEvents(name: QueueName): QueueEvents | null {
  if (!isRedisAvailable()) {
    return null;
  }

  if (queueEvents.has(name)) {
    return queueEvents.get(name)!;
  }

  const events = new QueueEvents(name, {
    connection: getConnection(),
  });

  queueEvents.set(name, events);
  return events;
}

/**
 * Get flow producer for job dependencies
 */
export function getFlowProducer(): FlowProducer | null {
  if (!isRedisAvailable()) {
    return null;
  }

  if (!flowProducer) {
    flowProducer = new FlowProducer({
      connection: getConnection(),
    });
  }

  return flowProducer;
}

// ============================================
// Job Scheduling Functions
// ============================================

/**
 * Add a scrape job
 */
export async function addScrapeJob(
  groupId: string,
  options?: { priority?: number; delay?: number }
): Promise<Job | null> {
  const queue = getQueue(QUEUE_NAMES.SCRAPE);
  if (!queue) return null;

  return queue.add(
    'scrape-group',
    { groupId, timestamp: Date.now() },
    {
      priority: options?.priority,
      delay: options?.delay,
      jobId: `scrape-${groupId}-${Date.now()}`,
    }
  );
}

/**
 * Add a classify job
 */
export async function addClassifyJob(
  batchSize?: number,
  options?: { priority?: number; delay?: number }
): Promise<Job | null> {
  const queue = getQueue(QUEUE_NAMES.CLASSIFY);
  if (!queue) return null;

  return queue.add(
    'classify-batch',
    { batchSize: batchSize || 25, timestamp: Date.now() },
    {
      priority: options?.priority,
      delay: options?.delay,
    }
  );
}

/**
 * Add a message job
 */
export async function addMessageJob(
  type: 'generate' | 'dispatch',
  options?: { priority?: number; delay?: number; limit?: number }
): Promise<Job | null> {
  const queue = getQueue(QUEUE_NAMES.MESSAGE);
  if (!queue) return null;

  return queue.add(
    `message-${type}`,
    { type, limit: options?.limit, timestamp: Date.now() },
    {
      priority: options?.priority,
      delay: options?.delay,
    }
  );
}

/**
 * Add a maintenance job
 */
export async function addMaintenanceJob(
  type: 'backup' | 'cleanup' | 'session-refresh' | 'session-check',
  options?: { priority?: number; delay?: number }
): Promise<Job | null> {
  const queue = getQueue(QUEUE_NAMES.MAINTENANCE);
  if (!queue) return null;

  return queue.add(
    `maintenance-${type}`,
    { type, timestamp: Date.now() },
    {
      priority: options?.priority,
      delay: options?.delay,
    }
  );
}

/**
 * Schedule repeating jobs (replaces cron)
 */
export async function scheduleRepeatingJobs(): Promise<void> {
  if (!isRedisAvailable()) {
    logger.warn('BullMQ: Redis not available, repeating jobs not scheduled');
    return;
  }

  // Scrape job - every 10 minutes
  const scrapeQueue = getQueue(QUEUE_NAMES.SCRAPE);
  if (scrapeQueue) {
    await scrapeQueue.add(
      'scrape-all',
      { all: true },
      {
        repeat: {
          pattern: '*/10 * * * *', // Every 10 minutes
        },
        jobId: 'scrape-all-repeat',
      }
    );
    logger.info('BullMQ: Scheduled scrape job (every 10 minutes)');
  }

  // Classify job - every 3 minutes
  const classifyQueue = getQueue(QUEUE_NAMES.CLASSIFY);
  if (classifyQueue) {
    await classifyQueue.add(
      'classify-batch',
      { batchSize: 25 },
      {
        repeat: {
          pattern: '*/3 * * * *', // Every 3 minutes
        },
        jobId: 'classify-repeat',
      }
    );
    logger.info('BullMQ: Scheduled classify job (every 3 minutes)');
  }

  // Message job - every 5 minutes
  const messageQueue = getQueue(QUEUE_NAMES.MESSAGE);
  if (messageQueue) {
    await messageQueue.add(
      'message-pipeline',
      { type: 'pipeline' },
      {
        repeat: {
          pattern: '*/5 * * * *', // Every 5 minutes
        },
        jobId: 'message-repeat',
      }
    );
    logger.info('BullMQ: Scheduled message job (every 5 minutes)');
  }

  // Session check - every hour
  const maintenanceQueue = getQueue(QUEUE_NAMES.MAINTENANCE);
  if (maintenanceQueue) {
    await maintenanceQueue.add(
      'maintenance-session-check',
      { type: 'session-check' },
      {
        repeat: {
          pattern: '0 * * * *', // Every hour
        },
        jobId: 'session-check-repeat',
      }
    );

    // Backup - daily at 2 AM
    await maintenanceQueue.add(
      'maintenance-backup',
      { type: 'backup' },
      {
        repeat: {
          pattern: '0 2 * * *', // Daily at 2 AM
        },
        jobId: 'backup-repeat',
      }
    );

    // Session refresh - daily at midnight
    await maintenanceQueue.add(
      'maintenance-session-refresh',
      { type: 'session-refresh' },
      {
        repeat: {
          pattern: '0 0 * * *', // Daily at midnight
        },
        jobId: 'session-refresh-repeat',
      }
    );

    logger.info('BullMQ: Scheduled maintenance jobs');
  }
}

// ============================================
// Queue Status & Monitoring
// ============================================

/**
 * Get status of all queues
 */
export async function getQueueStatus(): Promise<Record<string, unknown>> {
  const status: Record<string, unknown> = {};

  for (const [name, queue] of queues) {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
      ]);

      status[name] = {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + delayed,
      };
    } catch (error) {
      status[name] = { error: (error as Error).message };
    }
  }

  return status;
}

/**
 * Get recent jobs from a queue
 */
export async function getRecentJobs(
  name: QueueName,
  status: 'completed' | 'failed' | 'waiting' | 'active' | 'delayed' = 'completed',
  limit = 10
): Promise<Job[]> {
  const queue = queues.get(name);
  if (!queue) return [];

  try {
    return await queue.getJobs([status], 0, limit - 1);
  } catch {
    return [];
  }
}

/**
 * Pause a queue
 */
export async function pauseQueue(name: QueueName): Promise<boolean> {
  const queue = queues.get(name);
  if (!queue) return false;

  await queue.pause();
  logger.info(`Queue ${name} paused`);
  return true;
}

/**
 * Resume a queue
 */
export async function resumeQueue(name: QueueName): Promise<boolean> {
  const queue = queues.get(name);
  if (!queue) return false;

  await queue.resume();
  logger.info(`Queue ${name} resumed`);
  return true;
}

/**
 * Clean old jobs from a queue
 */
export async function cleanQueue(
  name: QueueName,
  grace: number = 24 * 3600 * 1000, // 24 hours
  status: 'completed' | 'failed' = 'completed'
): Promise<number> {
  const queue = queues.get(name);
  if (!queue) return 0;

  const removed = await queue.clean(grace, 1000, status);
  logger.info(`Cleaned ${removed.length} ${status} jobs from ${name}`);
  return removed.length;
}

// ============================================
// Cleanup
// ============================================

/**
 * Gracefully close all queues and workers
 */
export async function closeAllQueues(): Promise<void> {
  logger.info('BullMQ: Closing all queues and workers...');

  // Close workers first
  for (const [name, worker] of workers) {
    try {
      await worker.close();
      logger.debug(`Worker ${name} closed`);
    } catch (error) {
      logger.warn(`Error closing worker ${name}: ${(error as Error).message}`);
    }
  }

  // Close queue events
  for (const [name, events] of queueEvents) {
    try {
      await events.close();
      logger.debug(`QueueEvents ${name} closed`);
    } catch (error) {
      logger.warn(`Error closing events ${name}: ${(error as Error).message}`);
    }
  }

  // Close queues
  for (const [name, queue] of queues) {
    try {
      await queue.close();
      logger.debug(`Queue ${name} closed`);
    } catch (error) {
      logger.warn(`Error closing queue ${name}: ${(error as Error).message}`);
    }
  }

  // Close flow producer
  if (flowProducer) {
    try {
      await flowProducer.close();
      logger.debug('FlowProducer closed');
    } catch (error) {
      logger.warn(`Error closing FlowProducer: ${(error as Error).message}`);
    }
  }

  workers.clear();
  queueEvents.clear();
  queues.clear();
  flowProducer = null;

  logger.info('BullMQ: All queues and workers closed');
}

export default {
  QUEUE_NAMES,
  getQueue,
  createWorker,
  getQueueEvents,
  getFlowProducer,
  addScrapeJob,
  addClassifyJob,
  addMessageJob,
  addMaintenanceJob,
  scheduleRepeatingJobs,
  getQueueStatus,
  getRecentJobs,
  pauseQueue,
  resumeQueue,
  cleanQueue,
  closeAllQueues,
};
