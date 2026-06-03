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
import { getCookieHealth } from '../facebook/session';
import { loadSessionHealth } from '../session/sessionHealth';
import {
  markGroupScraped,
  markGroupError,
  updateGroupCache,
} from './groupDetector';
import { getActiveGroupIds } from './groupRegistry';
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
 * Get configured group IDs from the GroupInfo registry (DB-backed).
 */
const getGroupIds = async (): Promise<string[]> => {
  return getActiveGroupIds();
};

/**
 * Known group-rule / pinned-announcement / group-description text patterns.
 * If a scraped post's text BEGINS with any of these (case-insensitive), we
 * drop it — these are not user-generated content. Extend this list as we
 * encounter new patterns.
 *
 * Conservative: only matches start-of-string anchors, not substrings, so we
 * don't drop legitimate posts that quote rule text.
 */
const GROUP_RULE_PATTERNS: RegExp[] = [
  /^Please be respectful/i,
  /^When posting photographs/i,
  /^הקבוצה מיועדת/, // "This group is intended for…" (group description starter)
  /^חוקי הקבוצה/, // "Group rules"
  /^Group rules/i,
  /^Welcome to the group/i,
  /^This is a group for/i,
  /^Read the rules before posting/i,
];

/**
 * Returns true if a post should be SKIPPED (not saved to DB). Reasons:
 *   - Author is the logged-in user themselves (page chrome picked up as author)
 *   - Post has no author at all (rare — usually means we caught a page widget)
 *   - Post text starts with a known group-rule/description pattern
 */
const shouldSkipPost = (post: NormalizedPost, selfUserId: string | null): { skip: boolean; reason?: string } => {
  // Filter 1: posts authored by the logged-in user. The extractor sometimes
  // picks up the sticky header / left-sidebar avatar as the post author.
  if (selfUserId && post.authorLink) {
    // Match either profile.php?id={selfUserId} or /{selfUserId}/ patterns.
    const link = post.authorLink;
    if (
      link.includes(`profile.php?id=${selfUserId}`) ||
      new RegExp(`/${selfUserId}(/|$|\\?)`).test(link)
    ) {
      return { skip: true, reason: `author is the logged-in scraping account (${selfUserId})` };
    }
  }

  // Filter 2: posts with no author at all are almost always page-chrome bits
  // (group description, "What's on your mind?" widget, etc.).
  if (!post.authorName && !post.authorLink) {
    return { skip: true, reason: 'post has no author attribution' };
  }

  // Filter 3: post text starts with a known group-rule pattern.
  const text = (post.text || '').trim();
  for (const pattern of GROUP_RULE_PATTERNS) {
    if (pattern.test(text)) {
      return { skip: true, reason: `matches group-rule pattern ${pattern}` };
    }
  }

  return { skip: false };
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
      // Use getCookieHealth() — it actually checks the cookies on disk for
      // c_user + xs presence + expiry. isSessionValid() only reads the
      // in-memory health flag, which can be stale.
      const cookieHealth = await getCookieHealth();
      const sessionValid = cookieHealth.hasSession;

      if (sessionValid) {
        try {
          logger.info(`[Orchestrator] Trying Playwright for group ${groupId}`);
          posts = await scrapeGroupWithPlaywright(groupId);

          if (posts.length > 0) {
            result.method = 'playwright';
            logger.info(`[Orchestrator] Playwright SUCCESS for ${groupId}: ${posts.length} posts`);
            // markGroupScraped at the end of this function will set
            // accessMethod=playwright and lastScraped — no need to update
            // the cache here.
          } else {
            const msg = `Playwright returned 0 posts for ${groupId} — likely a login wall or empty feed`;
            logger.warn(`[Orchestrator] ${msg}`);
            await logSystemEvent('error', msg);
            result.errorMessage = 'No new posts found in feed';
            // Playwright reached the group page successfully, just no new
            // posts — cache that fact so we keep using Playwright next time
            // instead of re-probing other methods.
            await updateGroupCache(groupId, { accessMethod: 'playwright', isAccessible: true });
          }
        } catch (playwrightError) {
          const errorMsg = (playwrightError as Error).message;
          logger.error(`[Orchestrator] Playwright failed for ${groupId}: ${errorMsg}`);
          // Surface to the dashboard logs — previously this was logger-only.
          await logSystemEvent('error', `Playwright failed for ${groupId}: ${errorMsg}`);
          result.errorMessage = errorMsg;

          // Always update the cache so we know this group has been attempted.
          // Mark inaccessible only on clear access errors (membership /
          // privacy / takedown); for transient errors (timeouts, network),
          // keep isAccessible:true so the next cycle retries.
          const isAccessError =
            errorMsg.includes('not a member') ||
            errorMsg.includes('private') ||
            errorMsg.includes('Join group') ||
            errorMsg.includes('Content isn') ||
            errorMsg.includes('not available');
          await updateGroupCache(groupId, {
            accessMethod: 'playwright', // we tried this method — remember it
            isAccessible: !isAccessError,
            errorMessage: errorMsg,
          });
        }
      } else {
        const msg = `No valid Facebook session - skipping Playwright for ${groupId}`;
        logger.warn(`[Orchestrator] ${msg}`);
        await logSystemEvent('error', msg);
        result.errorMessage = 'No valid Facebook session';
      }
    }

    // Process posts
    if (posts.length > 0) {
      result.postsFound = posts.length;

      // Resolve the current FB user once per scrape so we can filter out
      // posts the extractor mistakenly attributed to the logged-in account
      // itself (a common DOM-heuristic failure mode).
      const selfHealth = await getCookieHealth();
      const selfUserId = selfHealth?.userId || null;

      let skipped = 0;
      for (const post of posts) {
        const skipDecision = shouldSkipPost(post, selfUserId);
        if (skipDecision.skip) {
          skipped++;
          logger.info(`[Orchestrator] Dropping post in ${groupId} — ${skipDecision.reason}`);
          continue;
        }
        const saved = await upsertPost(post);
        if (saved) {
          result.postsSaved++;
        } else {
          result.errors++;
        }
      }

      result.success = result.postsSaved > 0;
      await markGroupScraped(groupId, result.method);

      const summary = skipped > 0
        ? `Group ${groupId}: ${result.postsSaved}/${result.postsFound} posts saved via ${result.method} (${skipped} filtered out: self-author / rule-text / unauthored)`
        : `Group ${groupId}: ${result.postsSaved}/${result.postsFound} posts saved via ${result.method}`;
      logger.info(`[Orchestrator] ${summary}`);
      // Make per-group success visible on the dashboard Logs page, not just
      // in stdout. Previously only the per-group ERROR path was logSystemEvent'd.
      if (result.success || skipped > 0) {
        await logSystemEvent('scrape', summary);
      }
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
      // Surface 0-posts cases to the dashboard too. If we see the same group
      // posting "no new posts" for many cycles in a row, that's a hint to
      // investigate even though it isn't strictly an error.
      await logSystemEvent('scrape', `Group ${groupId} loaded but feed had no new posts`);
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
  const groupIds = await getGroupIds();

  if (groupIds.length === 0) {
    logger.warn('[Orchestrator] No groups configured. Add groups via the dashboard or seed GROUP_IDS env.');
    await logSystemEvent('scrape', 'Skipped scrape: no active groups in GroupInfo');
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
  const groupIds = await getGroupIds();

  // Batch fetch all group info from cache - DO NOT call detectGroupType()
  // detectGroupType() triggers isSessionValid() and other operations for EACH group
  // which causes rate limiting issues when dashboard polls frequently
  const cachedGroups = await prisma.groupInfo.findMany({
    where: { groupId: { in: groupIds } },
  });

  const cachedMap = new Map(cachedGroups.map((g: any) => [g.groupId, g]));

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
