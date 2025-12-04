import cron from 'node-cron';
import { dispatchMessages } from '../messenger/messenger';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { generateMessages } from '../ai/generator';

let isMessageCronRunning = false;

cron.schedule('*/5 * * * *', async () => {
  if (isMessageCronRunning) {
    logger.warn('Message cron still running, skipping');
    return;
  }

  isMessageCronRunning = true;
  logger.info('Running message cron');
  try {
    await generateMessages();
    await dispatchMessages();
  } catch (error) {
    logger.error(`Message cron failed: ${error}`);
    await logSystemEvent('error', `Message cron failed: ${(error as Error).message}`);
  } finally {
    isMessageCronRunning = false;
  }
});
