import cron from 'node-cron';
import { classifyPosts } from '../ai/classifier';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';

cron.schedule('*/3 * * * *', async () => {
  logger.info('Running classify cron');
  try {
    await classifyPosts();
  } catch (error) {
    logger.error(`Classify cron failed: ${error}`);
    await logSystemEvent('error', `Classify cron failed: ${(error as Error).message}`);
  }
});
