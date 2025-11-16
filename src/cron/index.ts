import logger from '../utils/logger';
import './scrape-cron';
import './classify-cron';
import './message-cron';
import './login-refresh';

logger.info('Cron schedules registered');
