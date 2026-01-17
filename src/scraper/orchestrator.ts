/**
 * Scraping Orchestrator
 *
 * Smart router that decides which scraping method to use based on:
 * - Group type (public/private)
 * - Session health
 * - Previous success/failure patterns
 *
 * Method priority (2025 optimized):
 * 1. MBasic - Plain HTML, fastest, hard to detect
 * 2. Apify - Reliable for public groups
 * 3. Playwright - Fallback for private groups
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { isApifyConfigured, scrapeGroupWithApify, NormalizedPost } from './apifyScraper';
import { scrapeGroupWithMBasic, isMBasicAvailable } from './mbasicScraper';
import { scrapeGroupWithPlaywright } from './playwrightScraper';
import { isSessionValid } from '../session/sessionManager';
import { loadSessionHealth } from '../session/sessionHealth';
import {
  markGroupScraped,
  markGroupError,
  updateGroupCache,
} from './groupDetector';
import { AccessMethod } from '@prisma/client';

export interface ScrapeResult {
  groupId: string;
  success: boolean;
  method: AccessMethod;
  postsFound: number;
  postsSaved: number;
  errors: number;
  errorMessage: string | null;
  duration: number;
}

/**
 * Get configured group IDs from environment
 */
const getGroupIds = (): string[] => {
  return (process.env.GROUP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
};

/**
 * Upsert a single post into the database
 * Note: Only updates authorName/authorLink/authorPhoto if new values are provided,
 * preserving existing data when extraction doesn't find these fields
 */
const upsertPost = async (post: NormalizedPost): Promise<boolean> => {
  try {
    // Build update object - only include fields that have new values
    // This prevents overwriting existing photos/names with null
    const updateData: Record<string, unknown> = {
      text: post.text,
      scrapedAt: new Date(),
    };

    // Only update author fields if we have new data
    if (post.authorName) updateData.authorName = post.authorName;
    if (post.authorLink) updateData.authorLink = post.authorLink;
    if (post.authorPhoto) updateData.authorPhoto = post.authorPhoto;

    await prisma.postRaw.upsert({
      where: { fbPostId: post.fbPostId },
      update: updateData,
      create: {
        fbPostId: post.fbPostId,
        groupId: post.groupId,
        authorName: post.authorName,
        authorLink: post.authorLink,
        authorPhoto: post.authorPhoto,
        text: post.text,
        scrapedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    logger.error(`Failed to upsert post ${post.fbPostId}: ${(error as Error).message}`);
    return false;
  }
};

/**
 * Scrape a single group using the appropriate method
 */
export const scrapeGroup = async (groupId: string): Promise<ScrapeResult> => {
  const startTime = Date.now();
  const result: ScrapeResult = {
    groupId,
    success: false,
    method: 'none',
    postsFound: 0,
    postsSaved: 0,
    errors: 0,
    errorMessage: null,
    duration: 0,
  };

  logger.info(`[Orchestrator] Starting scrape for group ${groupId}`);
  await logSystemEvent('scrape', `Scraping started for group ${groupId}`);

  try {
    let posts: NormalizedPost[] = [];

    // OPTIMIZATION: First check if we already know which method works for this group
    // This avoids unnecessary Apify probes that trigger circuit breaker issues
    const existingCache = await prisma.groupInfo.findUnique({ where: { groupId } });

    let knownWorkingMethod: AccessMethod = 'none';

    if (existingCache && existingCache.accessMethod !== 'none') {
      // We already know which method works - use it directly without re-probing
      knownWorkingMethod = existingCache.accessMethod;
      logger.info(`[Orchestrator] Group ${groupId}: using known method '${knownWorkingMethod}' (skipping detection)`);
    } else {
      // New group or unknown method - do full detection
      logger.info(`[Orchestrator] Group ${groupId}: no known method, will try all methods`);
    }

    logger.info(`[Orchestrator] Group ${groupId}: method=${knownWorkingMethod}`);

    // SMART METHOD SELECTION: Use the method that we know works for this group
    // If we've successfully used a method before, use it directly (skip others)
    if (knownWorkingMethod === 'apify') {
      // Apify worked before - use it directly
      logger.info(`[Orchestrator] Using cached method: Apify for group ${groupId}`);
      try {
        posts = await scrapeGroupWithApify(groupId);
        if (posts.length > 0) {
          result.method = 'apify';
          logger.info(`[Orchestrator] Apify SUCCESS for ${groupId}: ${posts.length} posts`);
        }
      } catch (apifyError) {
        logger.warn(`[Orchestrator] Apify failed for ${groupId}: ${(apifyError as Error).message}`);
        // Apify stopped working - clear the cached method so we try others
        await updateGroupCache(groupId, { accessMethod: 'none' });
      }
    } else if (knownWorkingMethod === 'mbasic') {
      // MBasic worked before - use it directly
      logger.info(`[Orchestrator] Using cached method: MBasic for group ${groupId}`);
      try {
        posts = await scrapeGroupWithMBasic(groupId);
        if (posts.length > 0) {
          result.method = 'mbasic';
          logger.info(`[Orchestrator] MBasic SUCCESS for ${groupId}: ${posts.length} posts`);
        }
      } catch (mbasicError) {
        logger.warn(`[Orchestrator] MBasic failed for ${groupId}: ${(mbasicError as Error).message}`);
        await updateGroupCache(groupId, { accessMethod: 'none' });
      }
    } else if (knownWorkingMethod === 'playwright') {
      // Playwright worked before (Apify/MBasic don't work for this group) - use it directly
      logger.info(`[Orchestrator] Using cached method: Playwright for group ${groupId}`);
      // Skip directly to Playwright (handled below)
    }

    // If cached method didn't work or no cached method, try available methods
    // NOTE: Apify is DISABLED because Facebook blocks it for most groups
    // We go directly to Playwright which works reliably with authenticated sessions
    if (posts.length === 0 && knownWorkingMethod !== 'playwright') {
      // Try MBasic first (fastest, if available)
      const mbasicAvailable = await isMBasicAvailable();
      if (mbasicAvailable) {
        try {
          logger.info(`[Orchestrator] Trying MBasic for group ${groupId}`);
          posts = await scrapeGroupWithMBasic(groupId);

          if (posts.length > 0) {
            result.method = 'mbasic';
            logger.info(`[Orchestrator] MBasic SUCCESS for ${groupId}: ${posts.length} posts`);
            await updateGroupCache(groupId, { accessMethod: 'mbasic', isAccessible: true, errorMessage: null });
          }
        } catch (mbasicError) {
          logger.warn(`[Orchestrator] MBasic failed for ${groupId}: ${(mbasicError as Error).message}`);
        }
      }

      // SKIP APIFY - It's blocked by Facebook for Israeli history groups
      // Apify returns "Empty or private data" error for all these groups
      // even though they are PUBLIC. Going directly to Playwright saves time
      // and avoids circuit breaker issues.
      if (posts.length === 0) {
        logger.debug(`[Orchestrator] Skipping Apify (known to be blocked by Facebook)`);
      }
    }

    // Step 3: Playwright - the reliable fallback (or the known working method)
    if (posts.length === 0) {
      const sessionValid = await isSessionValid();

      if (sessionValid) {
        try {
          logger.info(`[Orchestrator] Trying Playwright for group ${groupId}`);
          posts = await scrapeGroupWithPlaywright(groupId);

          if (posts.length > 0) {
            result.method = 'playwright';
            logger.info(`[Orchestrator] Playwright SUCCESS for ${groupId}: ${posts.length} posts`);
            // Cache 'playwright' as the working method - future scrapes will use it directly
            // This avoids wasting time on Apify/MBasic that don't work for this group
            await updateGroupCache(groupId, { accessMethod: 'playwright', isAccessible: true, errorMessage: null });
          } else {
            logger.warn(`[Orchestrator] Playwright returned 0 posts for ${groupId}`);
            result.errorMessage = 'No new posts found in feed';
            // Still mark playwright as the method - it loaded the page successfully
            await updateGroupCache(groupId, { accessMethod: 'playwright', isAccessible: true });
          }
        } catch (playwrightError) {
          const errorMsg = (playwrightError as Error).message;
          logger.error(`[Orchestrator] Playwright failed for ${groupId}: ${errorMsg}`);
          result.errorMessage = errorMsg;

          // Only mark as inaccessible if it's a clear access error
          if (errorMsg.includes('not a member') || errorMsg.includes('private') || errorMsg.includes('Join group') || errorMsg.includes('Content isn') || errorMsg.includes('not available')) {
            await updateGroupCache(groupId, { isAccessible: false, errorMessage: errorMsg });
          }
        }
      } else {
        logger.warn(`[Orchestrator] No valid session for Playwright - skipping ${groupId}`);
        result.errorMessage = 'No valid Facebook session';
      }
    }

    // Process posts
    if (posts.length > 0) {
      result.postsFound = posts.length;

      for (const post of posts) {
        const saved = await upsertPost(post);
        if (saved) {
          result.postsSaved++;
        } else {
          result.errors++;
        }
      }

      result.success = result.postsSaved > 0;
      await markGroupScraped(groupId, result.method);

      logger.info(`[Orchestrator] Group ${groupId}: ${result.postsSaved}/${result.postsFound} posts saved via ${result.method}`);
    } else {
      if (!result.errorMessage) {
        result.errorMessage = 'No new posts found';
      }
      // Don't mark as inaccessible just because no posts were found
      // The group might be empty or already fully scraped
      // Only log the warning - keep the group accessible
      await updateGroupCache(groupId, {
        errorMessage: result.errorMessage,
        // Keep isAccessible: true - 0 posts doesn't mean inaccessible
      });
      logger.warn(`[Orchestrator] Group ${groupId}: ${result.errorMessage}`);
    }

  } catch (error) {
    result.errorMessage = (error as Error).message;
    logger.error(`[Orchestrator] Error scraping group ${groupId}: ${result.errorMessage}`);
    await markGroupError(groupId, result.errorMessage);
  }

  result.duration = Date.now() - startTime;
  return result;
};

/**
 * Scrape all configured groups
 * Main entry point for the cron job
 */
export const scrapeAllGroupsOrchestrated = async (): Promise<{
  totalGroups: number;
  successfulGroups: number;
  failedGroups: number;
  totalPosts: number;
  results: ScrapeResult[];
}> => {
  const groupIds = getGroupIds();

  if (groupIds.length === 0) {
    logger.warn('[Orchestrator] No groups configured. Set GROUP_IDS env variable.');
    await logSystemEvent('scrape', 'Skipped scrape: GROUP_IDS is empty');
    return {
      totalGroups: 0,
      successfulGroups: 0,
      failedGroups: 0,
      totalPosts: 0,
      results: [],
    };
  }

  logger.info(`[Orchestrator] Starting orchestrated scrape for ${groupIds.length} group(s)`);

  // Check session health before starting
  const sessionHealth = await loadSessionHealth();
  const hasValidSession = sessionHealth.status === 'valid';

  if (!hasValidSession && !isApifyConfigured()) {
    logger.error('[Orchestrator] No valid session and Apify not configured. Cannot scrape.');
    await logSystemEvent('scrape', 'Scrape aborted: No valid session and Apify not configured');
    return {
      totalGroups: groupIds.length,
      successfulGroups: 0,
      failedGroups: groupIds.length,
      totalPosts: 0,
      results: groupIds.map((groupId) => ({
        groupId,
        success: false,
        method: 'none' as AccessMethod,
        postsFound: 0,
        postsSaved: 0,
        errors: 0,
        errorMessage: 'No scraping method available',
        duration: 0,
      })),
    };
  }

  const results: ScrapeResult[] = [];
  let successfulGroups = 0;
  let failedGroups = 0;
  let totalPosts = 0;

  for (const groupId of groupIds) {
    const result = await scrapeGroup(groupId);
    results.push(result);

    if (result.success) {
      successfulGroups++;
      totalPosts += result.postsSaved;
    } else {
      failedGroups++;
    }
  }

  // Log summary
  const summary = `Orchestrated scrape complete: ${successfulGroups}/${groupIds.length} groups successful, ${totalPosts} posts saved`;
  logger.info(`[Orchestrator] ${summary}`);
  await logSystemEvent('scrape', summary);

  // Log method breakdown
  const methodCounts = results.reduce((acc, r) => {
    acc[r.method] = (acc[r.method] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  logger.info(`[Orchestrator] Methods used: ${JSON.stringify(methodCounts)}`);

  return {
    totalGroups: groupIds.length,
    successfulGroups,
    failedGroups,
    totalPosts,
    results,
  };
};

/**
 * Get scraping status for all groups
 * NOTE: This function reads from cache only - it does NOT trigger fresh detection.
 * This is important to avoid excessive API calls when the dashboard polls for status.
 */
export const getScrapingStatus = async (): Promise<{
  groups: Array<{
    groupId: string;
    groupType: string;
    accessMethod: string;
    isAccessible: boolean;
    lastScraped: Date | null;
  }>;
  sessionValid: boolean;
  apifyConfigured: boolean;
  mbasicAvailable: boolean;
}> => {
  const groupIds = getGroupIds();

  // Batch fetch all group info from cache - DO NOT call detectGroupType()
  // detectGroupType() triggers isSessionValid() and other operations for EACH group
  // which causes rate limiting issues when dashboard polls frequently
  const cachedGroups = await prisma.groupInfo.findMany({
    where: { groupId: { in: groupIds } },
  });

  const cachedMap = new Map(cachedGroups.map(g => [g.groupId, g]));

  const groups = groupIds.map(groupId => {
    const cached = cachedMap.get(groupId);
    return {
      groupId,
      groupType: cached?.groupType || 'unknown',
      accessMethod: cached?.accessMethod || 'none',
      isAccessible: cached?.isAccessible ?? true,
      lastScraped: cached?.lastScraped || null,
    };
  });

  return {
    groups,
    sessionValid: await isSessionValid(),
    apifyConfigured: isApifyConfigured(),
    mbasicAvailable: await isMBasicAvailable(),
  };
};
