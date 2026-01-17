/**
 * Group Detector
 *
 * Detects whether a Facebook group is public or private and determines
 * the best method to scrape it.
 */

import prisma from '../database/prisma';
import logger from '../utils/logger';
import { isSessionValid } from '../session/sessionManager';
import { GroupType, AccessMethod } from '@prisma/client';
// Note: Apify imports removed - Facebook blocks Apify for most groups

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

  // APIFY DISABLED: Facebook blocks Apify for most groups, returning "Empty or private data"
  // errors even for PUBLIC groups. We skip Apify probing entirely and rely on Playwright
  // to detect group type from the actual page content.
  //
  // The Playwright scraper now detects group type by checking for "Public group" or
  // "Private group" text on the page, which is 100% accurate.
  logger.debug(`Skipping Apify probe for ${groupId} - Facebook blocks Apify for most groups`);

  // Check if we have a valid session for Playwright
  const hasSession = await isSessionValid();

  if (hasSession) {
    // We have a valid session - Playwright can access the group
    // The actual group type (public/private) will be detected by Playwright
    // when it scrapes the page and reads the "Public group" or "Private group" text
    await updateGroupCache(groupId, {
      groupType: 'unknown', // Will be updated by Playwright when it scrapes
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null, // No errors - we have a working method
    });

    return {
      groupId,
      groupType: 'unknown',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
    };
  } else {
    // No valid session - need to login first
    const noSessionMessage = 'No valid Facebook session. Please login with: npx ts-node src/scripts/facebook-login.ts';

    await updateGroupCache(groupId, {
      groupType: 'unknown',
      accessMethod: 'none',
      isAccessible: false,
      errorMessage: noSessionMessage,
    });

    return {
      groupId,
      groupType: 'unknown',
      accessMethod: 'none',
      isAccessible: false,
      errorMessage: noSessionMessage,
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
    // Note: Apify is blocked by Facebook, so we use Playwright for all groups
    return {
      method: 'playwright',
      isAccessible: await isSessionValid(),
      reason: 'Public group - using Playwright (Apify blocked by Facebook)',
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

  // Unknown type - use Playwright (Apify is blocked by Facebook)
  return {
    method: 'playwright',
    isAccessible: await isSessionValid(),
    reason: 'Unknown group type - using Playwright to detect and scrape',
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
 * IMPORTANT: Always clears errorMessage - a successful scrape means no error
 */
export const markGroupScraped = async (
  groupId: string,
  method: AccessMethod
): Promise<void> => {
  await updateGroupCache(groupId, {
    accessMethod: method,
    lastScraped: new Date(),
    isAccessible: true,
    errorMessage: null,  // Always clear - success means no error
  });
  logger.debug(`Group ${groupId} marked as successfully scraped via ${method}`);
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
