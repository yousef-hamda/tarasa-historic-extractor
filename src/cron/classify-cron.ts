import cron from 'node-cron';
import { classifyPosts } from '../ai/classifier';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { withLock } from '../utils/cronLock';

const CLASSIFY_SCHEDULE = process.env.CLASSIFY_CRON_SCHEDULE || '*/3 * * * *';

cron.schedule(CLASSIFY_SCHEDULE, () => {
  // Wrap in immediately invoked async function with error boundary
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
      // Catch any errors from withLock itself
      logger.error(`Classify cron outer error: ${(error as Error).message}`);
    }
  })();
});
