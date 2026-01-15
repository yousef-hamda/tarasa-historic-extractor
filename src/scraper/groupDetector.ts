/**
 * Group Detector
 *
 * Detects whether a Facebook group is public or private and determines
 * the best method to scrape it.
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';
import { isApifyConfigured, scrapeGroupWithApify } from './apifyScraper';
import { isSessionValid } from '../session/sessionManager';
import { GroupType, AccessMethod } from '@prisma/client';

export interface GroupDetectionResult {
  groupId: string;
  groupType: GroupType;
  accessMethod: AccessMethod;
  isAccessible: boolean;
  errorMessage: string | null;
}

/**
 * Get cached group info from database
 */
export const getCachedGroupInfo = async (groupId: string) => {
  try {
    return await prisma.groupInfo.findUnique({
      where: { groupId },
    });
  } catch (error) {
    logger.error(`Failed to get cached group info: ${(error as Error).message}`);
    return null;
  }
};

/**
 * Update group info in cache
 */
export const updateGroupCache = async (
  groupId: string,
  data: {
    groupType?: GroupType;
    groupName?: string | null;
    memberCount?: number | null;
    accessMethod?: AccessMethod;
    isAccessible?: boolean;
    errorMessage?: string | null;
    lastScraped?: Date;
  }
): Promise<void> => {
  try {
    await prisma.groupInfo.upsert({
      where: { groupId },
      update: {
        ...data,
        lastChecked: new Date(),
      },
      create: {
        groupId,
        groupType: data.groupType || 'unknown',
        groupName: data.groupName,
        memberCount: data.memberCount,
        accessMethod: data.accessMethod || 'none',
        isAccessible: data.isAccessible ?? true,
        errorMessage: data.errorMessage,
        lastScraped: data.lastScraped,
      },
    });
  } catch (error) {
    logger.error(`Failed to update group cache: ${(error as Error).message}`);
  }
};

/**
 * Detect group type by attempting to scrape with Apify
 * If Apify returns posts, it's public. If not, we need Playwright to verify.
 * IMPORTANT: Don't assume a group is private just because Apify failed -
 * it could be due to circuit breaker, rate limits, or temporary issues.
 */
export const detectGroupType = async (groupId: string): Promise<GroupDetectionResult> => {
  logger.info(`Detecting group type for ${groupId}...`);

  // Check cache first
  const cached = await getCachedGroupInfo(groupId);
  if (cached && cached.groupType !== 'unknown') {
    // If cache is less than 24 hours old, use it
    const cacheAge = Date.now() - cached.lastChecked.getTime();
    if (cacheAge < 24 * 60 * 60 * 1000) {
      logger.info(`Using cached group type for ${groupId}: ${cached.groupType}`);
      return {
        groupId,
        groupType: cached.groupType,
        accessMethod: cached.accessMethod,
        isAccessible: cached.isAccessible,
        errorMessage: cached.errorMessage,
      };
    }
  }

  // Track if Apify failed due to circuit breaker or other reasons
  let apifyFailed = false;
  let apifyError = '';

  // Try Apify to detect if public
  if (isApifyConfigured()) {
    try {
      logger.info(`Probing group ${groupId} with Apify...`);
      const posts = await scrapeGroupWithApify(groupId, 5); // Just get 5 posts to test

      if (posts.length > 0) {
        // Group is public - Apify can access it
        logger.info(`Group ${groupId} is PUBLIC (Apify returned ${posts.length} posts)`);
        await updateGroupCache(groupId, {
          groupType: 'public',
          accessMethod: 'apify',
          isAccessible: true,
          errorMessage: null,
        });

        return {
          groupId,
          groupType: 'public',
          accessMethod: 'apify',
          isAccessible: true,
          errorMessage: null,
        };
      } else {
        // No posts returned - could be private OR empty group
        // Don't assume private yet
        logger.info(`Group ${groupId} - Apify returned 0 posts, needs verification`);
      }
    } catch (error) {
      apifyFailed = true;
      apifyError = (error as Error).message;
      logger.warn(`Apify probe failed for ${groupId}: ${apifyError}`);
    }
  } else {
    // Apify not configured - we can't determine if public or private
    apifyFailed = true;
    apifyError = 'Apify not configured';
  }

  // Check if we have a valid session for Playwright
  const hasSession = await isSessionValid();

  if (hasSession) {
    // We have a session - the group is accessible via Playwright
    // Don't assume it's private - it might be public but Apify failed
    const groupType = apifyFailed && apifyError.includes('circuit breaker')
      ? 'unknown'  // Keep as unknown if we couldn't determine due to circuit breaker
      : 'private'; // Otherwise likely private since Apify couldn't get posts

    await updateGroupCache(groupId, {
      groupType: groupType as GroupType,
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: apifyFailed ? `Will use Playwright (${apifyError})` : null,
    });

    return {
      groupId,
      groupType: groupType as GroupType,
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
    };
  } else {
    // No session - check if we should mark as inaccessible
    // Only mark as inaccessible if we know Apify also failed definitively
    if (apifyFailed && !apifyError.includes('circuit breaker')) {
      await updateGroupCache(groupId, {
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: false,
        errorMessage: 'No valid Facebook session. Please login with: npx ts-node src/scripts/facebook-login.ts',
      });

      return {
        groupId,
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: false,
        errorMessage: 'No valid Facebook session. Please login with: npx ts-node src/scripts/facebook-login.ts',
      };
    }

    // If Apify failed due to circuit breaker, don't mark as inaccessible yet
    // The group might be public and will work once circuit breaker resets
    await updateGroupCache(groupId, {
      groupType: 'unknown',
      accessMethod: 'none',
      isAccessible: true, // Assume accessible - circuit breaker is temporary
      errorMessage: apifyError || 'Status unknown - will retry',
    });

    return {
      groupId,
      groupType: 'unknown',
      accessMethod: 'none',
      isAccessible: true, // Optimistic - don't show as inaccessible due to temporary issues
      errorMessage: apifyError || 'Status unknown - will retry',
    };
  }
};

/**
 * Get the recommended access method for a group
 */
export const getRecommendedAccessMethod = async (
  groupId: string
): Promise<{ method: AccessMethod; isAccessible: boolean; reason: string }> => {
  const detection = await detectGroupType(groupId);

  if (detection.groupType === 'public') {
    return {
      method: 'apify',
      isAccessible: true,
      reason: 'Public group - using Apify for fast, reliable scraping',
    };
  }

  if (detection.groupType === 'private') {
    if (detection.isAccessible) {
      return {
        method: 'playwright',
        isAccessible: true,
        reason: 'Private group - using Playwright with authenticated session',
      };
    } else {
      return {
        method: 'none',
        isAccessible: false,
        reason: detection.errorMessage || 'Cannot access private group without session',
      };
    }
  }

  // Unknown type - try Apify first
  return {
    method: isApifyConfigured() ? 'apify' : 'playwright',
    isAccessible: isApifyConfigured() || (await isSessionValid()),
    reason: 'Unknown group type - will probe to determine access method',
  };
};

/**
 * Get all configured groups with their access info
 */
export const getGroupsWithAccessInfo = async (): Promise<
  Array<{
    groupId: string;
    groupType: GroupType;
    accessMethod: AccessMethod;
    isAccessible: boolean;
    lastScraped: Date | null;
  }>
> => {
  const groupIds = (process.env.GROUP_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const results = [];

  for (const groupId of groupIds) {
    const cached = await getCachedGroupInfo(groupId);

    if (cached) {
      results.push({
        groupId,
        groupType: cached.groupType,
        accessMethod: cached.accessMethod,
        isAccessible: cached.isAccessible,
        lastScraped: cached.lastScraped,
      });
    } else {
      // New groups default to accessible until proven otherwise
      results.push({
        groupId,
        groupType: 'unknown' as GroupType,
        accessMethod: 'none' as AccessMethod,
        isAccessible: true,
        lastScraped: null,
      });
    }
  }

  return results;
};

/**
 * Mark a group as successfully scraped
 */
export const markGroupScraped = async (
  groupId: string,
  method: AccessMethod
): Promise<void> => {
  await updateGroupCache(groupId, {
    accessMethod: method,
    lastScraped: new Date(),
    isAccessible: true,
    errorMessage: null,
  });
};

/**
 * Mark a group as having an error
 */
export const markGroupError = async (
  groupId: string,
  error: string
): Promise<void> => {
  await updateGroupCache(groupId, {
    isAccessible: false,
    errorMessage: error,
  });
};
