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
  detectGroupType,
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
 */
const upsertPost = async (post: NormalizedPost): Promise<boolean> => {
  try {
    await prisma.postRaw.upsert({
      where: { fbPostId: post.fbPostId },
      update: {
        authorName: post.authorName,
        authorLink: post.authorLink,
        authorPhoto: post.authorPhoto,
        text: post.text,
        scrapedAt: new Date(),
      },
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

    // Check cached group info to optimize method selection
    const cachedInfo = await detectGroupType(groupId);
    const isKnownPrivate = cachedInfo.groupType === 'private';
    const knownWorkingMethod = cachedInfo.accessMethod;

    // If we know the group is private, skip MBasic and Apify (they won't work)
    if (isKnownPrivate) {
      logger.info(`[Orchestrator] Group ${groupId} is known private, skipping MBasic and Apify`);
    }

    // Step 1: Try MBasic first (fastest, lightweight HTML, hard to detect)
    // Skip for known private groups - MBasic doesn't work with auth sessions
    if (!isKnownPrivate) {
      const mbasicAvailable = await isMBasicAvailable();
      if (mbasicAvailable) {
        try {
          logger.info(`[Orchestrator] Trying MBasic for group ${groupId}`);
          posts = await scrapeGroupWithMBasic(groupId);

          if (posts.length > 0) {
            result.method = 'mbasic';
            logger.info(`[Orchestrator] MBasic SUCCESS for ${groupId}: ${posts.length} posts`);
            await updateGroupCache(groupId, { accessMethod: 'mbasic', isAccessible: true });
          } else {
            logger.info(`[Orchestrator] MBasic returned 0 posts for ${groupId}`);
          }
        } catch (mbasicError) {
          logger.warn(`[Orchestrator] MBasic failed for ${groupId}: ${(mbasicError as Error).message}`);
          // Continue to Apify
        }
      } else {
        logger.info(`[Orchestrator] MBasic not available (no valid session)`);
      }
    }

    // Step 2: Try Apify (works for public groups, reliable)
    // Skip for known private groups - Apify cannot access private groups
    if (posts.length === 0 && !isKnownPrivate && isApifyConfigured()) {
      try {
        logger.info(`[Orchestrator] Trying Apify for group ${groupId}`);
        posts = await scrapeGroupWithApify(groupId);

        if (posts.length > 0) {
          result.method = 'apify';
          logger.info(`[Orchestrator] Apify SUCCESS for ${groupId}: ${posts.length} posts`);
          await updateGroupCache(groupId, { groupType: 'public', accessMethod: 'apify', isAccessible: true });
        } else {
          logger.info(`[Orchestrator] Apify returned 0 posts for ${groupId} (likely private group)`);
          // Mark as private so we skip these methods next time
          await updateGroupCache(groupId, { groupType: 'private' });
        }
      } catch (apifyError) {
        logger.warn(`[Orchestrator] Apify failed for ${groupId}: ${(apifyError as Error).message}`);
        // Continue to Playwright
      }
    }

    // Step 3: Try Playwright as fallback (works for all groups with auth)
    if (posts.length === 0) {
      const sessionValid = await isSessionValid();

      if (sessionValid) {
        try {
          logger.info(`[Orchestrator] Trying Playwright for group ${groupId}`);
          posts = await scrapeGroupWithPlaywright(groupId);

          if (posts.length > 0) {
            result.method = 'playwright';
            logger.info(`[Orchestrator] Playwright SUCCESS for ${groupId}: ${posts.length} posts`);
            await updateGroupCache(groupId, { groupType: 'private', accessMethod: 'playwright', isAccessible: true });
          } else {
            logger.warn(`[Orchestrator] Playwright returned 0 posts for ${groupId}`);
            result.errorMessage = 'No new posts found in feed';
            // Still mark as accessible since we successfully loaded the page
            await updateGroupCache(groupId, { groupType: 'private', accessMethod: 'playwright', isAccessible: true });
          }
        } catch (playwrightError) {
          const errorMsg = (playwrightError as Error).message;
          logger.error(`[Orchestrator] Playwright failed for ${groupId}: ${errorMsg}`);
          result.errorMessage = errorMsg;

          // Only mark as inaccessible if it's a clear access error
          if (errorMsg.includes('not a member') || errorMsg.includes('private') || errorMsg.includes('Join group')) {
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
  const groups = [];

  for (const groupId of groupIds) {
    const detection = await detectGroupType(groupId);
    const cached = await prisma.groupInfo.findUnique({ where: { groupId } });

    groups.push({
      groupId,
      groupType: detection.groupType,
      accessMethod: detection.accessMethod,
      isAccessible: detection.isAccessible,
      lastScraped: cached?.lastScraped || null,
    });
  }

  return {
    groups,
    sessionValid: await isSessionValid(),
    apifyConfigured: isApifyConfigured(),
    mbasicAvailable: await isMBasicAvailable(),
  };
};
