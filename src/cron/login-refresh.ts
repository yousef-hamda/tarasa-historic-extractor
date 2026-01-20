import cron from 'node-cron';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { refreshFacebookSession } from '../facebook/session';

cron.schedule('0 0 * * *', async () => {
  logger.info('Refreshing Facebook login session');
  try {
    const result = await refreshFacebookSession();
    if (result.success) {
      logger.info('Login refresh completed successfully');
      await logSystemEvent('auth', 'Daily session refresh completed successfully');
    } else {
      logger.warn(`Login refresh failed: ${result.error}`);
      await logSystemEvent('error', `Daily login refresh failed: ${result.error}`);
    }
  } catch (error) {
    logger.error(`Login refresh failed: ${error}`);
    await logSystemEvent('error', `Login refresh failed: ${(error as Error).message}`);
  }
});
