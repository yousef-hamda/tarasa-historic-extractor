import cron, { ScheduledTask } from 'node-cron';
import { dispatchMessages } from '../messenger/messenger';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { generateMessages } from '../ai/generator';
import { withLock } from '../utils/cronLock';

const messageTick = (): void => {
  (async () => {
    try {
      await withLock('message', async () => {
        logger.info('Running message cron');
        try {
          await generateMessages();
          await dispatchMessages();
        } catch (error) {
          logger.error(`Message cron failed: ${(error as Error).message}`);
          await logSystemEvent('error', `Message cron failed: ${(error as Error).message}`);
        }
      });
    } catch (error) {
      logger.error(`Message cron outer error: ${(error as Error).message}`);
    }
  })();
};

/**
 * Register the message cron with the given schedule. Returns the live handle
 * so the scheduler can `.stop()` it before re-registering on a preset change.
 * `MESSAGE_CRON_SCHEDULE` env var, if set, overrides the dashboard preset.
 */
export const registerMessageCron = (schedule: string): ScheduledTask => {
  const effective = process.env.MESSAGE_CRON_SCHEDULE || schedule;
  if (!cron.validate(effective)) {
    throw new Error(`Invalid message cron schedule: ${effective}`);
  }
  return cron.schedule(effective, messageTick);
};
