import cron from 'node-cron';
import { scrapeGroups } from '../scraper/scraper';
import logger from '../utils/logger';

cron.schedule('*/10 * * * *', async () => {
  logger.info('Running scrape cron');
  await scrapeGroups();
});
