import cron from 'node-cron';
// Using the new orchestrator for intelligent scraping
import { scrapeAllGroupsOrchestrated } from '../scraper/orchestrator';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { withLock } from '../utils/cronLock';

const SCRAPE_SCHEDULE = process.env.SCRAPE_CRON_SCHEDULE || '*/10 * * * *';

cron.schedule(SCRAPE_SCHEDULE, () => {
  // Wrap in immediately invoked async function with error boundary
  (async () => {
    try {
      await withLock('scrape', async () => {
        logger.info('Running orchestrated scrape cron');
        try {
          // Use the new orchestrator which intelligently picks the best method
          const result = await scrapeAllGroupsOrchestrated();

          // Log results
          if (result.totalGroups > 0) {
            logger.info(
              `Scrape cron complete: ${result.successfulGroups}/${result.totalGroups} groups, ${result.totalPosts} posts`
            );
          }
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
