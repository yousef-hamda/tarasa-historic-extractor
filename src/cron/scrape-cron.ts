import cron from 'node-cron';
import { scrapeGroups } from '../scraper/scraper';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';

cron.schedule('*/10 * * * *', async () => {
  logger.info('Running scrape cron');
  try {
    await scrapeGroups();
  } catch (error) {
    logger.error(`Scrape cron failed: ${error}`);
    await logSystemEvent('error', `Scrape cron failed: ${(error as Error).message}`);
  }
});
