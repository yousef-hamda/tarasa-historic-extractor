import cron from 'node-cron';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { refreshFacebookSession } from '../facebook/session';

let isLoginRefreshRunning = false;

cron.schedule('0 0 * * *', async () => {
  if (isLoginRefreshRunning) {
    logger.warn('Login refresh still running, skipping');
    return;
  }

  isLoginRefreshRunning = true;
  logger.info('Refreshing Facebook login session');
  try {
    await refreshFacebookSession();
  } catch (error) {
    logger.error(`Login refresh failed: ${error}`);
    await logSystemEvent('error', `Login refresh failed: ${(error as Error).message}`);
  } finally {
    isLoginRefreshRunning = false;
  }
});
