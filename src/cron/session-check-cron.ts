/**
 * Session Check Cron
 *
 * Periodically validates the Facebook session and updates health status.
 * Sends alerts if the session becomes invalid or blocked.
 */

import cron from 'node-cron';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { withLock } from '../utils/cronLock';
import { checkAndUpdateSession } from '../session/sessionManager';
import { loadSessionHealth, sessionNeedsRefresh } from '../session/sessionHealth';
import { sendAlertEmail } from '../utils/alerts';

// Check session every 30 minutes
const SESSION_CHECK_SCHEDULE = process.env.SESSION_CHECK_CRON_SCHEDULE || '*/30 * * * *';

cron.schedule(SESSION_CHECK_SCHEDULE, () => {
  (async () => {
    try {
      await withLock('session-check', async () => {
        logger.info('Running session health check');

        try {
          // Check if session needs refresh (older than 12 hours)
          const needsRefresh = await sessionNeedsRefresh(12 * 60 * 60 * 1000);

          if (needsRefresh) {
            logger.info('Session needs refresh, performing full validation');
          }

          // Perform session check
          const health = await checkAndUpdateSession();

          // Handle different status outcomes
          switch (health.status) {
            case 'valid':
              logger.info(`Session check passed. User: ${health.userName || health.userId || 'unknown'}`);
              break;

            case 'expired':
              logger.warn('Session expired. Attempting auto-refresh on next scrape.');
              await logSystemEvent('auth', 'Session expired - will attempt refresh');
              break;

            case 'invalid':
              logger.error('Session invalid. Manual login required.');
              await logSystemEvent('auth', 'Session invalid - manual login required');
              await sendAlertEmail(
                'Tarasa: Facebook Login Required',
                `Your Facebook session is invalid and needs manual re-login.\n\nPlease run: npm run fb:login\n\nScraping of private groups is paused until login is completed.`
              );
              break;

            case 'blocked':
              logger.error(`Session blocked: ${health.errorMessage}`);
              await logSystemEvent('auth', `Session blocked: ${health.errorMessage}`);
              // Alert already sent by checkAndUpdateSession
              break;

            default:
              logger.warn(`Session status unknown: ${health.status}`);
          }

        } catch (error) {
          const errorMsg = (error as Error).message;
          logger.error(`Session check failed: ${errorMsg}`);
          await logSystemEvent('error', `Session check cron failed: ${errorMsg}`);
        }
      });
    } catch (error) {
      logger.error(`Session check cron outer error: ${(error as Error).message}`);
    }
  })();
});

logger.info(`Session check cron registered (schedule: ${SESSION_CHECK_SCHEDULE})`);
