import cron from 'node-cron';
import { scrapeGroups } from '../scraper/scraper';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { withLock } from '../utils/cronLock';

const SCRAPE_SCHEDULE = process.env.SCRAPE_CRON_SCHEDULE || '*/10 * * * *';

cron.schedule(SCRAPE_SCHEDULE, () => {
  // Wrap in immediately invoked async function with error boundary
  (async () => {
    try {
      await withLock('scrape', async () => {
        logger.info('Running scrape cron');
        try {
          await scrapeGroups();
        } catch (error) {
          logger.error(`Scrape cron failed: ${(error as Error).message}`);
          await logSystemEvent('error', `Scrape cron failed: ${(error as Error).message}`);
        }
      });
    } catch (error) {
      // Catch any errors from withLock itself
      logger.error(`Scrape cron outer error: ${(error as Error).message}`);
    }
  })();
});
