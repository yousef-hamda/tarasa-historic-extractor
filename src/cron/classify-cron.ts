import cron, { ScheduledTask } from 'node-cron';
import { classifyPosts } from '../ai/classifier';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { withLock } from '../utils/cronLock';

const classifyTick = (): void => {
  (async () => {
    try {
      await withLock('classify', async () => {
        logger.info('Running classify cron');
        try {
          await classifyPosts();
        } catch (error) {
          logger.error(`Classify cron failed: ${(error as Error).message}`);
          await logSystemEvent('error', `Classify cron failed: ${(error as Error).message}`);
        }
      });
    } catch (error) {
      logger.error(`Classify cron outer error: ${(error as Error).message}`);
    }
  })();
};

/**
 * Register the classify cron with the given schedule. Returns the live handle
 * so the scheduler can `.stop()` it before re-registering on a preset change.
 * `CLASSIFY_CRON_SCHEDULE` env var, if set, overrides the dashboard preset.
 */
export const registerClassifyCron = (schedule: string): ScheduledTask => {
  const effective = process.env.CLASSIFY_CRON_SCHEDULE || schedule;
  if (!cron.validate(effective)) {
    throw new Error(`Invalid classify cron schedule: ${effective}`);
  }
  return cron.schedule(effective, classifyTick);
};
