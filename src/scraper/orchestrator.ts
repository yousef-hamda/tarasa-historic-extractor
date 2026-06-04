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
  /^Please refrain from/i, // observed in prod: "Please refrain from hate speech..."
  /^When posting photographs/i,
  /^הקבוצה מיועדת/, // "This group is intended for…" (group description starter)
  /^חוקי הקבוצה/, // "Group rules"
  /^Group rules/i,
  /^Welcome to the group/i,
  /^Welcome to History of Israel/i, // observed in prod: pinned welcome / instructions
  /^Our group has several guidelines/i, // observed in prod: pinned group-norms
  /^This is a group for/i,
  /^Read the rules before posting/i,
];

/**
 * Real authorName values are human names. Strings ending in things like
 * "'s profile" or "'s timeline" are chrome artifacts the extractor sometimes
 * picks up from the sticky navbar / left sidebar — never a real post author.
 * Pattern is locale-tolerant: matches straight or curly apostrophes, English
 * "profile/timeline", and the leading whitespace FB tends to insert.
 */
const CHROME_NAME_SUFFIX = /[''']s\s+(profile|timeline|page)\s*$/i;

/**
 * Resolves the logged-in user's identity for self-author filtering. Returns
 * both the cookie's c_user value AND the DB-tracked userName so the filter
 * still fires even when one signal is degraded (e.g. cookies wiped on
 * redeploy but SessionState.userName persists in Postgres).
 */
const getSelfIdentity = async (): Promise<{ userId: string | null; userName: string | null }> => {
  let userId: string | null = null;
  let userName: string | null = null;
  try {
    const health = await getCookieHealth();
    userId = health?.userId || null;
  } catch {
    // ignore — fall through to DB
  }
  try {
    const row = await prisma.sessionState.findFirst({ orderBy: { createdAt: 'desc' } });
    if (row) {
      // Don't trust DB userId === "0" — that was the zombie-valid bug. The
      // sessionManager fix prevents new "0" rows but old rows may linger.
      if (row.userId && /^\d{5,}$/.test(row.userId) && row.userId !== '0') {
        userId = userId || row.userId;
      }
      if (row.userName) userName = row.userName;
    }
  } catch {
    // ignore
  }
  return { userId, userName };
};

interface SkipDecision {
  skip: boolean;
  reason?: string;
}

/**
 * Returns true if a post should be SKIPPED (not saved to DB). Layered:
 *   1. Author is the logged-in user themselves (cookie-based id match)
 *   2. Post has no author at all
 *   3. Post text starts with a known group-rule/description pattern
 *   4. Author name has chrome-artifact suffix ("X's profile", etc.)
 *   5. Author name exactly matches SessionState.userName (covers the case
 *      where cookie-based id matching fails — e.g. selfUserId is null —
 *      but we still know who the operator is from the DB)
 *   6. Skeptical: hash-fallback fbPostId AND no postUrl AND authorLink points
 *      to the logged-in user. This is the exact signature of the phantom
 *      posts in prod — three of four saved rows match this.
 */
const shouldSkipPost = (
  post: NormalizedPost,
  self: { userId: string | null; userName: string | null }
): SkipDecision => {
  const { userId, userName } = self;

  // Filter 1: posts authored by the logged-in user. The extractor sometimes
  // picks up the sticky header / left-sidebar avatar as the post author.
  const linkMatchesSelf =
    userId && post.authorLink
      ? post.authorLink.includes(`profile.php?id=${userId}`) ||
        new RegExp(`/${userId}(/|$|\\?)`).test(post.authorLink)
      : false;
  if (linkMatchesSelf) {
    return { skip: true, reason: `author is the logged-in scraping account (${userId})` };
  }

  // Filter 2: posts with no author at all are almost always page-chrome bits.
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

  // Filter 4: chrome-artifact suffix in the author name.
  if (post.authorName && CHROME_NAME_SUFFIX.test(post.authorName.trim())) {
    return { skip: true, reason: `chrome-artifact author name: "${post.authorName}"` };
  }

  // Filter 5: author name exact-matches the operator's known userName. This
  // catches the case where cookie state is degraded but we still know who
  // the operator is from SessionState.
  if (userName && post.authorName && post.authorName.trim() === userName.trim()) {
    return { skip: true, reason: `author name matches the logged-in operator (${userName})` };
  }

  // Filter 6: skeptical bundle. A post with no postUrl AND a content-hash
  // fbPostId AND a self-profile authorLink is the exact signature the
  // production extractor produced for nav-chrome elements. Each signal alone
  // can be legitimate; together they're almost certainly chrome.
  const hasHashId = post.fbPostId.startsWith('hash_');
  const hasNoUrl = !post.postUrl;
  if (hasHashId && hasNoUrl && linkMatchesSelf) {
    return { skip: true, reason: 'hash-fallback id + no postUrl + self-profile link = chrome' };
  }

  return { skip: false };
};

/** Visible for tests. */
export const _shouldSkipPostForTests = shouldSkipPost;
export const _chromeNameSuffix = CHROME_NAME_SUFFIX;

/**
 * Upsert a single post into the database
 * Note: Only updates authorName/authorLink/authorPhoto if new values are provided,
 * preserving existing data when extraction doesn't find these fields
 */
/**
 * Resolve the best Facebook URL for a post. Same logic as
 * ui/dashboard/utils/postUrl.ts so the scraper, dashboard, and email export
 * agree on when a link can be shown.
 *
 *   1. If the extractor captured `postUrl`, use it as-is.
 *   2. Otherwise, when `fbPostId` is numeric (not our hash_ fallback), build
 *      `https://www.facebook.com/groups/{groupId}/posts/{fbPostId}`.
 *   3. Otherwise null — we have no way to construct a permalink.
 */
const resolvePostUrl = (post: NormalizedPost): string | null => {
  if (post.postUrl) return post.postUrl;
  if (!post.fbPostId || !post.groupId) return null;
  if (post.fbPostId.startsWith('hash_')) return null;
  if (!/^\d+$/.test(post.fbPostId)) return null;
  return `https://www.facebook.com/groups/${post.groupId}/posts/${post.fbPostId}`;
};

const upsertPost = async (post: NormalizedPost): Promise<boolean> => {
  try {
    // Resolve postUrl FIRST so every code path stores it. The previous
    // upsert was building the update + create blocks without postUrl at all,
    // which is why ~100% of rows in the DB ended up with postUrl=null even
    // though every numeric-id post could have had one constructed.
    const resolvedPostUrl = resolvePostUrl(post);

    // Build update object — only include fields that have new values, so
    // re-scrapes don't blow away author/photo/url data we previously had.
    const updateData: Record<string, unknown> = {
      text: post.text,
      scrapedAt: new Date(),
    };

    if (post.authorName) updateData.authorName = post.authorName;
    if (post.authorLink) updateData.authorLink = post.authorLink;
    if (post.authorPhoto) updateData.authorPhoto = post.authorPhoto;
    if (resolvedPostUrl) updateData.postUrl = resolvedPostUrl;

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
        postUrl: resolvedPostUrl,
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
      // itself (a common DOM-heuristic failure mode). Now uses BOTH the
      // cookie c_user value AND the DB-tracked SessionState.userName as
      // secondary signal — degraded cookies don't disarm the filter.
      const self = await getSelfIdentity();

      let skipped = 0;
      for (const post of posts) {
        const skipDecision = shouldSkipPost(post, self);
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
    // telegram: true — entire scrape cycle aborted because there's no
    // session AND no Apify fallback. This means the pipeline is dark
    // until the operator re-renews cookies. Worth one alert per scrape
    // cycle (5-min dedup in sendSystemAlert keeps it from spamming).
    await logSystemEvent('scrape', 'Scrape aborted: No valid session and Apify not configured', { telegram: true });
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
