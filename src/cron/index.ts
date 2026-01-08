import logger from '../utils/logger';
import './scrape-cron';
import './classify-cron';
import './message-cron';
import './login-refresh';
import './session-check-cron';

logger.info('Cron schedules registered (scrape, classify, message, login-refresh, session-check)');
