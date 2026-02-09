import logger from '../utils/logger';
import { initializeSession } from '../session/sessionManager';
import { logSystemEvent } from '../utils/systemLog';

// Initialize session before starting cron jobs
(async () => {
  try {
    const { ready, message } = await initializeSession();
    if (ready) {
      logger.info(`Session initialized: ${message}`);
      await logSystemEvent('auth', `Session initialized on startup: ${message}`);
    } else {
      logger.warn(`Session not ready on startup: ${message}`);
      logger.warn('Cron jobs will start but scraping may fail until session is fixed');
      await logSystemEvent('auth', `Session not ready: ${message}. Run: npm run fb:login`);
    }
  } catch (error) {
    logger.error(`Session initialization error: ${(error as Error).message}`);
  }
})();

// Register cron jobs
import './scrape-cron';
import './classify-cron';
import './message-cron';
import './login-refresh';
import './session-check-cron';
import './log-cleanup-cron';
import { startBackupCron } from './backup-cron';
import { startQualityRatingCron } from './quality-rating-cron';
import { startReportCron } from './report-cron';
import { startDuplicateDetectionCron } from './duplicate-detection-cron';

// Start backup cron
startBackupCron();

// Start quality rating cron
startQualityRatingCron();

// Start report cron
startReportCron();

// Start duplicate detection cron
startDuplicateDetectionCron();

// Start Telegram bot polling (listens for commands and questions)
import { startTelegramPolling } from '../utils/telegram';
startTelegramPolling();

logger.info('Cron schedules registered (scrape, classify, message, login-refresh, session-check, backup, log-cleanup, quality-rating, reports, duplicate-detection)');
