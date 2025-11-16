import cron from 'node-cron';
import { dispatchMessages } from '../messenger/messenger';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { generateMessages } from '../ai/generator';

cron.schedule('*/5 * * * *', async () => {
  logger.info('Running message cron');
  try {
    await generateMessages();
    await dispatchMessages();
  } catch (error) {
    logger.error(`Message cron failed: ${error}`);
    await logSystemEvent('error', `Message cron failed: ${(error as Error).message}`);
  }
});
