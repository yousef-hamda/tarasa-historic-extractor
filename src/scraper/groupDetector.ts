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
 * If Apify returns posts, it's public. If not, it's likely private.
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
        // No posts returned - likely private
        logger.info(`Group ${groupId} appears PRIVATE (Apify returned 0 posts)`);
      }
    } catch (error) {
      logger.warn(`Apify probe failed for ${groupId}: ${(error as Error).message}`);
    }
  }

  // Check if we have a valid session for Playwright
  const hasSession = await isSessionValid();

  if (hasSession) {
    // We have a session, so mark as private with Playwright access
    await updateGroupCache(groupId, {
      groupType: 'private',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
    });

    return {
      groupId,
      groupType: 'private',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
    };
  } else {
    // No session, can't access private groups
    await updateGroupCache(groupId, {
      groupType: 'private',
      accessMethod: 'none',
      isAccessible: false,
      errorMessage: 'No valid Facebook session for private group access',
    });

    return {
      groupId,
      groupType: 'private',
      accessMethod: 'none',
      isAccessible: false,
      errorMessage: 'No valid Facebook session for private group access',
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
      results.push({
        groupId,
        groupType: 'unknown' as GroupType,
        accessMethod: 'none' as AccessMethod,
        isAccessible: false,
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
