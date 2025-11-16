import cron from 'node-cron';
import { dispatchMessages } from '../messenger/messenger';
import logger from '../utils/logger';

cron.schedule('*/5 * * * *', async () => {
  logger.info('Running message cron');
  await dispatchMessages();
});
