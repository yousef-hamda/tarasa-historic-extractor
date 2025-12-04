import cron from 'node-cron';
import { scrapeGroups } from '../scraper/scraper';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';

let isScrapeRunning = false;

cron.schedule('*/10 * * * *', async () => {
  if (isScrapeRunning) {
    logger.warn('Scrape job still running, skipping');
    return;
  }

  isScrapeRunning = true;
  logger.info('Running scrape cron');
  try {
    await scrapeGroups();
  } catch (error) {
    logger.error(`Scrape cron failed: ${error}`);
    await logSystemEvent('error', `Scrape cron failed: ${(error as Error).message}`);
  } finally {
    isScrapeRunning = false;
  }
});
