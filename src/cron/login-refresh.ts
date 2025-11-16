import cron from 'node-cron';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { refreshFacebookSession } from '../facebook/session';

cron.schedule('0 0 * * *', async () => {
  logger.info('Refreshing Facebook login session');
  try {
    await refreshFacebookSession();
  } catch (error) {
    logger.error(`Login refresh failed: ${error}`);
    await logSystemEvent('error', `Login refresh failed: ${(error as Error).message}`);
  }
});
