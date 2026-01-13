/**
 * Scraping Orchestrator
 *
 * Smart router that decides which scraping method to use based on:
 * - Group type (public/private)
 * - Session health
 * - Previous success/failure patterns
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { isApifyConfigured, scrapeGroupWithApify, NormalizedPost } from './apifyScraper';
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

    // Step 1: Try Apify first (works for public groups, fast and reliable)
    if (isApifyConfigured()) {
      try {
        logger.info(`[Orchestrator] Trying Apify for group ${groupId}`);
        posts = await scrapeGroupWithApify(groupId);

        if (posts.length > 0) {
          result.method = 'apify';
          logger.info(`[Orchestrator] Apify SUCCESS for ${groupId}: ${posts.length} posts`);
          await updateGroupCache(groupId, { groupType: 'public', accessMethod: 'apify', isAccessible: true });
        } else {
          logger.info(`[Orchestrator] Apify returned 0 posts for ${groupId} (likely private group)`);
        }
      } catch (apifyError) {
        logger.warn(`[Orchestrator] Apify failed for ${groupId}: ${(apifyError as Error).message}`);
        // Continue to Playwright
      }
    }

    // Step 2: If Apify didn't get posts, try Playwright (works for all groups with auth)
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
            result.errorMessage = 'No posts found - user may not be a member of this group';
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
        result.errorMessage = 'No posts found';
      }
      await markGroupError(groupId, result.errorMessage);
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
  };
};
