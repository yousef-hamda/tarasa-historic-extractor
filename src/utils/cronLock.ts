import logger from './logger';

/**
 * Simple in-memory lock to prevent concurrent cron job execution.
 * Each job type has its own lock.
 */
const locks: Record<string, boolean> = {};

export const acquireLock = (jobName: string): boolean => {
  if (locks[jobName]) {
    logger.warn(`${jobName} is already running, skipping this execution`);
    return false;
  }
  locks[jobName] = true;
  return true;
};

export const releaseLock = (jobName: string): void => {
  locks[jobName] = false;
};

/**
 * Wrapper to run a job with lock protection
 */
export const withLock = async (jobName: string, job: () => Promise<void>): Promise<void> => {
  if (!acquireLock(jobName)) {
    return;
  }
  try {
    await job();
  } finally {
    releaseLock(jobName);
  }
};
