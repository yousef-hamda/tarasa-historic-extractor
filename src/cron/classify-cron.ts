import cron from 'node-cron';
import { classifyPosts } from '../ai/classifier';
import logger from '../utils/logger';

cron.schedule('*/3 * * * *', async () => {
  logger.info('Running classify cron');
  await classifyPosts();
});
