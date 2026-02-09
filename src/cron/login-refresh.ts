import cron from 'node-cron';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { refreshFacebookSession } from '../facebook/session';
import { withLock } from '../utils/cronLock';

// Daily login refresh at midnight
const LOGIN_REFRESH_SCHEDULE = process.env.LOGIN_REFRESH_CRON_SCHEDULE || '0 0 * * *';

cron.schedule(LOGIN_REFRESH_SCHEDULE, () => {
  // Wrap in immediately invoked async function with error boundary (same pattern as other crons)
  (async () => {
    try {
      await withLock('login-refresh', async () => {
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
    } catch (error) {
      // Catch any errors from withLock itself
      logger.error(`Login refresh cron outer error: ${(error as Error).message}`);
    }
  })();
});

logger.info(`Login refresh cron registered (schedule: ${LOGIN_REFRESH_SCHEDULE})`);
