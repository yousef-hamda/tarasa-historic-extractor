import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { logSystemEvent } from '../utils/systemLog';
import logger from '../utils/logger';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { safeErrorMessage } from '../middleware/errorHandler';

const router = Router();

/**
 * Validate that a group ID is safe to use (alphanumeric and dots/underscores only)
 */
const isValidGroupId = (groupId: string): boolean => {
  // Group IDs can be numeric or alphanumeric with dots, underscores, and hyphens
  // Max length 100 to prevent abuse
  return /^[a-zA-Z0-9._-]{1,100}$/.test(groupId);
};

// Get all groups with their info
router.get('/api/groups', async (_req: Request, res: Response) => {
  try {
    // Read the active group list from the DB (isEnabled=true), with full info
    const groupInfos = await prisma.groupInfo.findMany({
      where: { isEnabled: true },
      orderBy: { groupId: 'asc' },
    });

    const groups = groupInfos.map((info: typeof groupInfos[0]) => ({
      groupId: info.groupId,
      groupName: info.groupName || null,
      groupType: info.groupType || 'unknown',
      accessMethod: info.accessMethod || 'none',
      isAccessible: info.isAccessible ?? true,
      memberCount: info.memberCount || null,
      lastScraped: info.lastScraped || null,
      lastChecked: info.lastChecked || null,
      errorMessage: info.errorMessage || null,
    }));

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

    // Check if group already exists and is active
    const existing = await prisma.groupInfo.findUnique({ where: { groupId } });

    if (existing && existing.isEnabled) {
      return res.status(400).json({
        error: 'Group already exists',
        message: `Group ${groupId} is already in the list`,
      });
    }

    // Upsert: re-enable a previously-disabled group, or create fresh
    await prisma.groupInfo.upsert({
      where: { groupId },
      update: { isEnabled: true, lastChecked: new Date() },
      create: {
        groupId,
        isEnabled: true,
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: true,
      },
    });

    const totalGroups = await prisma.groupInfo.count({ where: { isEnabled: true } });

    await logSystemEvent('scrape', `Added group: ${groupId}`);

    res.json({
      success: true,
      message: `Group ${groupId} added successfully`,
      groupId,
      totalGroups,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Failed to add group: ${message}`);
    res.status(500).json({ error: 'Failed to add group', message });
  }
});

// Soft-disable a group (preserves history, can be re-added later)
router.delete('/api/groups/:groupId', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const { groupId } = req.params;

    const existing = await prisma.groupInfo.findUnique({ where: { groupId } });

    if (!existing || !existing.isEnabled) {
      return res.status(404).json({
        error: 'Group not found',
        message: `Group ${groupId} is not in the active list`,
      });
    }

    // Soft-disable: keep the row and its cached metadata, just flip isEnabled
    await prisma.groupInfo.update({
      where: { groupId },
      data: { isEnabled: false },
    });

    const totalGroups = await prisma.groupInfo.count({ where: { isEnabled: true } });

    await logSystemEvent('scrape', `Disabled group: ${groupId}`);

    res.json({
      success: true,
      message: `Group ${groupId} disabled successfully`,
      groupId,
      totalGroups,
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
    // Reset all active groups to trigger fresh detection
    const activeGroups = await prisma.groupInfo.findMany({
      where: { isEnabled: true },
      select: { groupId: true },
    });
    const groupIds = activeGroups.map((g: { groupId: string }) => g.groupId);

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
