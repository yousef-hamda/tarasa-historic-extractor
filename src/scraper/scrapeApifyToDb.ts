/**
 * Hybrid Scraper - Apify + Playwright Fallback
 *
 * This module implements a hybrid scraping approach:
 * 1. First tries Apify (fast, no browser needed, works for public groups)
 * 2. Falls back to Playwright if Apify returns no data (for private groups)
 *
 * Pipeline:
 *   cron -> scrapeAllGroups() -> Apify API -> [if empty] -> Playwright -> Prisma upsert -> PostRaw
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { scrapeGroupWithApify, isApifyConfigured, NormalizedPost } from './apifyScraper';
import { scrapeGroupWithPlaywright } from './playwrightScraper';

/**
 * Get group IDs from environment variable
 */
const getGroupIds = (): string[] => {
  return (process.env.GROUP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
};

/**
 * Upsert a single post into the database
 * Uses fbPostId as the unique identifier to prevent duplicates
 */
const upsertPost = async (post: NormalizedPost): Promise<boolean> => {
  try {
    await prisma.postRaw.upsert({
      where: { fbPostId: post.fbPostId },
      update: {
        // Update fields if post already exists (in case content changed)
        authorName: post.authorName,
        authorLink: post.authorLink,
        text: post.text,
        scrapedAt: new Date(),
      },
      create: {
        fbPostId: post.fbPostId,
        groupId: post.groupId,
        authorName: post.authorName,
        authorLink: post.authorLink,
        text: post.text,
        scrapedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to upsert post ${post.fbPostId}: ${errorMessage}`);
    return false;
  }
};

/**
 * Scrape a single Facebook group using hybrid approach:
 * 1. Try Apify first (for public groups)
 * 2. Fall back to Playwright if Apify returns no data (for private groups)
 *
 * @param groupId - The Facebook group ID to scrape
 * @returns Object with success status and counts
 */
export const scrapeAndSave = async (
  groupId: string
): Promise<{ success: boolean; total: number; saved: number; errors: number; method: 'apify' | 'playwright' | 'none' }> => {
  logger.info(`Starting hybrid scrape for group ${groupId}`);
  await logSystemEvent('scrape', `Scraping started for group ${groupId}`);

  let posts: NormalizedPost[] = [];
  let method: 'apify' | 'playwright' | 'none' = 'none';

  // Step 1: Try Apify first (fast, works for public groups)
  if (isApifyConfigured()) {
    try {
      logger.info(`[Step 1] Trying Apify for group ${groupId}...`);
      posts = await scrapeGroupWithApify(groupId);

      if (posts.length > 0) {
        method = 'apify';
        logger.info(`[Apify Success] Got ${posts.length} posts from group ${groupId}`);
      } else {
        logger.info(`[Apify] No posts returned - group may be private. Falling back to Playwright...`);
      }
    } catch (apifyError) {
      const errorMsg = apifyError instanceof Error ? apifyError.message : String(apifyError);
      logger.warn(`[Apify Error] ${errorMsg}. Falling back to Playwright...`);
    }
  } else {
    logger.info(`[Apify] Not configured. Using Playwright directly.`);
  }

  // Step 2: Fall back to Playwright if Apify didn't work
  if (posts.length === 0) {
    try {
      logger.info(`[Step 2] Using Playwright for group ${groupId}...`);
      posts = await scrapeGroupWithPlaywright(groupId);

      if (posts.length > 0) {
        method = 'playwright';
        logger.info(`[Playwright Success] Got ${posts.length} posts from group ${groupId}`);
      } else {
        logger.warn(`[Playwright] No posts extracted from group ${groupId}`);
      }
    } catch (playwrightError) {
      const errorMsg = playwrightError instanceof Error ? playwrightError.message : String(playwrightError);
      logger.error(`[Playwright Error] Failed to scrape group ${groupId}: ${errorMsg}`);
      await logSystemEvent('error', `Playwright scrape failed for group ${groupId}: ${errorMsg}`);
    }
  }

  // Step 3: Save posts to database
  if (posts.length === 0) {
    logger.warn(`No posts obtained from any method for group ${groupId}`);
    await logSystemEvent('scrape', `No posts found for group ${groupId}`);
    return { success: true, total: 0, saved: 0, errors: 0, method: 'none' };
  }

  let saved = 0;
  let errors = 0;

  for (const post of posts) {
    const success = await upsertPost(post);
    if (success) {
      saved++;
    } else {
      errors++;
    }
  }

  const message = `Scrape complete for group ${groupId} via ${method}: ${saved}/${posts.length} posts saved, ${errors} errors`;
  logger.info(message);
  await logSystemEvent('scrape', message);

  return {
    success: true,
    total: posts.length,
    saved,
    errors,
    method,
  };
};

/**
 * Scrape all configured groups using hybrid approach
 * This is the main entry point called by the cron job
 */
export const scrapeAllGroups = async (): Promise<void> => {
  const groupIds = getGroupIds();

  if (groupIds.length === 0) {
    logger.warn('No Facebook group IDs configured. Skipping scrape.');
    await logSystemEvent('scrape', 'Skipped scrape run because GROUP_IDS is empty');
    return;
  }

  logger.info(`Starting hybrid scrape for ${groupIds.length} group(s)`);

  let totalSaved = 0;
  let totalErrors = 0;
  const methods: Record<string, string> = {};

  for (const groupId of groupIds) {
    try {
      const result = await scrapeAndSave(groupId);
      totalSaved += result.saved;
      totalErrors += result.errors;
      methods[groupId] = result.method;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error scraping group ${groupId}: ${errorMessage}`);
      totalErrors++;
      methods[groupId] = 'error';
    }
  }

  logger.info(`All groups scraped. Total saved: ${totalSaved}, Total errors: ${totalErrors}`);
  logger.info(`Methods used: ${JSON.stringify(methods)}`);
};

// Export for backwards compatibility
export { scrapeAllGroups as scrapeGroups };
