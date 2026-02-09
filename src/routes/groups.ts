import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { logSystemEvent } from '../utils/systemLog';
import logger from '../utils/logger';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { safeErrorMessage } from '../middleware/errorHandler';
import * as fs from 'fs';
import * as path from 'path';

const router = Router();

/**
 * Validate that a group ID is safe to use (alphanumeric and dots/underscores only)
 */
const isValidGroupId = (groupId: string): boolean => {
  // Group IDs can be numeric or alphanumeric with dots, underscores, and hyphens
  // Max length 100 to prevent abuse
  return /^[a-zA-Z0-9._-]{1,100}$/.test(groupId);
};

/**
 * Safely update the GROUP_IDS in .env file with proper error handling
 * Returns true if successful, false otherwise
 */
const updateEnvGroupIds = (newGroups: string[]): boolean => {
  const envPath = path.resolve(process.cwd(), '.env');

  try {
    // Check if .env file exists
    if (!fs.existsSync(envPath)) {
      logger.error('Cannot update GROUP_IDS: .env file not found');
      return false;
    }

    const envContent = fs.readFileSync(envPath, 'utf-8');
    const newGroupIds = newGroups.join(',');

    // Check if GROUP_IDS line exists
    let updatedContent: string;
    if (/GROUP_IDS=/.test(envContent)) {
      // Replace existing GROUP_IDS line (escape special regex chars in group IDs)
      updatedContent = envContent.replace(
        /GROUP_IDS=.*/,
        `GROUP_IDS=${newGroupIds}`
      );
    } else {
      // Add GROUP_IDS line if it doesn't exist
      updatedContent = envContent + `\nGROUP_IDS=${newGroupIds}\n`;
    }

    fs.writeFileSync(envPath, updatedContent);

    // Update process.env
    process.env.GROUP_IDS = newGroupIds;

    return true;
  } catch (error) {
    logger.error(`Failed to update .env file: ${(error as Error).message}`);
    return false;
  }
};

// Get all groups with their info
router.get('/api/groups', async (_req: Request, res: Response) => {
  try {
    // Get groups from env
    const groupIds = (process.env.GROUP_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    // Get cached info from database
    const groupInfos = await prisma.groupInfo.findMany({
      where: { groupId: { in: groupIds } },
    });

    const groupInfoMap = new Map(groupInfos.map((g: typeof groupInfos[0]) => [g.groupId, g]));

    // Combine env groups with database info
    const groups = groupIds.map((groupId) => {
      const info = groupInfoMap.get(groupId);
      return {
        groupId,
        groupName: info?.groupName || null,
        groupType: info?.groupType || 'unknown',
        accessMethod: info?.accessMethod || 'none',
        isAccessible: info?.isAccessible ?? true,
        memberCount: info?.memberCount || null,
        lastScraped: info?.lastScraped || null,
        lastChecked: info?.lastChecked || null,
        errorMessage: info?.errorMessage || null,
      };
    });

    res.json({
      groups,
      total: groups.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to fetch groups: ${message}`);
    res.status(500).json({ error: 'Failed to fetch groups', message });
  }
});

// Add a new group
router.post('/api/groups', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const { groupUrl, groupId: providedGroupId } = req.body;

    // Extract group ID from URL or use provided ID
    let groupId = providedGroupId;
    if (groupUrl && !groupId) {
      // Extract group ID from various URL formats
      const urlPatterns = [
        /facebook\.com\/groups\/(\d+)/,
        /facebook\.com\/groups\/([a-zA-Z0-9._-]+)/,
        /fb\.com\/groups\/(\d+)/,
        /fb\.com\/groups\/([a-zA-Z0-9._-]+)/,
      ];

      for (const pattern of urlPatterns) {
        const match = groupUrl.match(pattern);
        if (match) {
          groupId = match[1];
          break;
        }
      }
    }

    if (!groupId) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Please provide a valid Facebook group URL or group ID',
      });
    }

    // Validate group ID format
    if (!isValidGroupId(groupId)) {
      return res.status(400).json({
        error: 'Invalid group ID',
        message: 'Group ID must be alphanumeric (1-100 characters, may include dots, underscores, and hyphens)',
      });
    }

    // Get current groups from env
    const currentGroups = (process.env.GROUP_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    // Check if group already exists
    if (currentGroups.includes(groupId)) {
      return res.status(400).json({
        error: 'Group already exists',
        message: `Group ${groupId} is already in the list`,
      });
    }

    // Add new group to the list
    const newGroups = [...currentGroups, groupId];

    // Update .env file with proper error handling
    if (!updateEnvGroupIds(newGroups)) {
      return res.status(500).json({
        error: 'Failed to persist group',
        message: 'Could not update configuration file. Group added to memory only.',
      });
    }

    // Create initial entry in database
    await prisma.groupInfo.upsert({
      where: { groupId },
      update: { lastChecked: new Date() },
      create: {
        groupId,
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: true,
      },
    });

    await logSystemEvent('scrape', `Added new group: ${groupId}`);

    res.json({
      success: true,
      message: `Group ${groupId} added successfully`,
      groupId,
      totalGroups: newGroups.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to add group: ${message}`);
    res.status(500).json({ error: 'Failed to add group', message });
  }
});

// Delete a group
router.delete('/api/groups/:groupId', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    // Get current groups from env
    const currentGroups = (process.env.GROUP_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    // Check if group exists
    if (!currentGroups.includes(groupId)) {
      return res.status(404).json({
        error: 'Group not found',
        message: `Group ${groupId} is not in the list`,
      });
    }

    // Remove group from list
    const newGroups = currentGroups.filter((id) => id !== groupId);

    // Update .env file with proper error handling
    if (!updateEnvGroupIds(newGroups)) {
      return res.status(500).json({
        error: 'Failed to persist removal',
        message: 'Could not update configuration file. Group removed from memory only.',
      });
    }

    // Optionally remove from database cache
    await prisma.groupInfo.delete({
      where: { groupId },
    }).catch((err: any) => {
      // Log but don't fail if not in database
      logger.debug(`Group ${groupId} not found in database cache: ${err.message}`);
    });

    await logSystemEvent('scrape', `Removed group: ${groupId}`);

    res.json({
      success: true,
      message: `Group ${groupId} removed successfully`,
      groupId,
      totalGroups: newGroups.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to delete group: ${message}`);
    res.status(500).json({ error: 'Failed to delete group', message });
  }
});

// Reset ALL groups cache (force re-detection for all)
router.post('/api/groups/reset-all', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    // Get all groups from env
    const groupIds = (process.env.GROUP_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    // Reset all group info to trigger fresh detection
    let resetCount = 0;
    for (const groupId of groupIds) {
      await prisma.groupInfo.upsert({
        where: { groupId },
        update: {
          groupType: 'unknown',
          accessMethod: 'none',
          isAccessible: true,
          errorMessage: null,
          lastChecked: new Date(),
        },
        create: {
          groupId,
          groupType: 'unknown',
          accessMethod: 'none',
          isAccessible: true,
        },
      });
      resetCount++;
    }

    await logSystemEvent('scrape', `Reset detection cache for all ${resetCount} groups`);

    res.json({
      success: true,
      message: `Reset ${resetCount} groups. All groups are now marked as accessible.`,
      resetCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to reset all groups: ${message}`);
    res.status(500).json({ error: 'Failed to reset all groups', message });
  }
});

// Reset group cache (force re-detection)
router.post('/api/groups/:groupId/reset', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    // Reset group info to trigger fresh detection
    await prisma.groupInfo.upsert({
      where: { groupId },
      update: {
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: true,
        errorMessage: null,
        lastChecked: new Date(),
      },
      create: {
        groupId,
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: true,
      },
    });

    await logSystemEvent('scrape', `Reset detection cache for group: ${groupId}`);

    res.json({
      success: true,
      message: `Group ${groupId} cache reset. Will be re-detected on next scrape.`,
      groupId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to reset group cache: ${message}`);
    res.status(500).json({ error: 'Failed to reset group cache', message });
  }
});

// Update group info (name, etc.)
router.patch('/api/groups/:groupId', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;
    const { groupName, memberCount } = req.body;

    const updated = await prisma.groupInfo.upsert({
      where: { groupId },
      update: {
        groupName: groupName || undefined,
        memberCount: memberCount || undefined,
        lastChecked: new Date(),
      },
      create: {
        groupId,
        groupName,
        memberCount,
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: true,
      },
    });

    res.json({
      success: true,
      group: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to update group: ${message}`);
    res.status(500).json({ error: 'Failed to update group', message });
  }
});

export default router;
