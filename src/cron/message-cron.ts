import cron from 'node-cron';
import { dispatchMessages } from '../messenger/messenger';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { generateMessages } from '../ai/generator';
import { withLock } from '../utils/cronLock';

const MESSAGE_SCHEDULE = process.env.MESSAGE_CRON_SCHEDULE || '*/5 * * * *';

cron.schedule(MESSAGE_SCHEDULE, () => {
  // Wrap in immediately invoked async function with error boundary
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
      // Catch any errors from withLock itself
      logger.error(`Message cron outer error: ${(error as Error).message}`);
    }
  })();
});
