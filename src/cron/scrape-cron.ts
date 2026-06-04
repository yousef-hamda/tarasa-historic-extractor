import cron, { ScheduledTask } from 'node-cron';
// Using the new orchestrator for intelligent scraping
import { scrapeAllGroupsOrchestrated } from '../scraper/orchestrator';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { withLock } from '../utils/cronLock';

/**
 * Build the scrape cron's tick handler. Factored out so unit tests can fire it
 * directly without spinning up the cron scheduler.
 */
const scrapeTick = (): void => {
  (async () => {
    try {
      await withLock('scrape', async () => {
        logger.info('Running orchestrated scrape cron');
        try {
          const result = await scrapeAllGroupsOrchestrated();
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
      logger.error(`Scrape cron outer error: ${(error as Error).message}`);
    }
  })();
};

/**
 * Register the scrape cron with the given schedule. Returns the live handle
 * so the scheduler can `.stop()` it before re-registering on a preset change.
 *
 * The env var `SCRAPE_CRON_SCHEDULE` overrides any schedule passed in — useful
 * for ops to pin a specific cadence regardless of the dashboard preset.
 */
export const registerScrapeCron = (schedule: string): ScheduledTask => {
  const effective = process.env.SCRAPE_CRON_SCHEDULE || schedule;
  if (!cron.validate(effective)) {
    throw new Error(`Invalid scrape cron schedule: ${effective}`);
  }
  return cron.schedule(effective, scrapeTick);
};
