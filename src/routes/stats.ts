import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { getDailyMessageUsage } from '../utils/quota';

const router = Router();

/**
 * Get activity data for the chart (last N days)
 * This queries the database directly for accurate totals
 */
router.get('/api/stats/activity', async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);

    // Get all posts scraped in the date range
    const posts = await prisma.postRaw.findMany({
      where: {
        scrapedAt: { gte: startDate }
      },
      select: {
        scrapedAt: true,
        classified: {
          select: { classifiedAt: true }
        }
      }
    });

    // Get all messages sent in the date range
    const messages = await prisma.messageSent.findMany({
      where: {
        sentAt: { gte: startDate }
      },
      select: { sentAt: true }
    });

    // Build daily data
    const dailyData: Record<string, { posts: number; classified: number; messages: number }> = {};

    // Initialize all days
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      dailyData[dateStr] = { posts: 0, classified: 0, messages: 0 };
    }

    // Count posts per day
    for (const post of posts) {
      const dateStr = post.scrapedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (dailyData[dateStr]) {
        dailyData[dateStr].posts++;
        if (post.classified) {
          dailyData[dateStr].classified++;
        }
      }
    }

    // Count messages per day
    for (const msg of messages) {
      const dateStr = msg.sentAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (dailyData[dateStr]) {
        dailyData[dateStr].messages++;
      }
    }

    // Convert to array format
    const result = Object.entries(dailyData).map(([date, data]) => ({
      date,
      ...data
    }));

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch activity data', message });
  }
});

router.get('/api/stats', async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      postsTotal,
      classifiedTotal,
      historicTotal,
      queueCount,
      logsCount,
      lastScrape,
      lastMessage,
      usage,
    ] = await Promise.all([
      prisma.postRaw.count(),
      prisma.postClassified.count(),
      prisma.postClassified.count({ where: { isHistoric: true } }),
      prisma.messageGenerated.count(),
      prisma.systemLog.count(),
      prisma.systemLog.findFirst({ where: { type: 'scrape' }, orderBy: { createdAt: 'desc' } }),
      prisma.messageSent.findFirst({ orderBy: { sentAt: 'desc' } }),
      getDailyMessageUsage(),
    ]);

    res.json({
      postsTotal,
      classifiedTotal,
      historicTotal,
      queueCount,
      sentLast24h: usage.sentLast24h,
      quotaRemaining: usage.remaining,
      messageLimit: usage.limit,
      logsCount,
      lastScrapeAt: lastScrape?.createdAt ?? null,
      lastMessageSentAt: lastMessage?.sentAt ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch stats', message });
  }
});

/**
 * Delete all scraped data (posts, classifications, messages, logs)
 * This is a destructive operation - use with caution!
 */
router.delete('/api/data/reset', async (_req: Request, res: Response) => {
  try {
    // Delete in order to respect foreign key constraints
    // 1. Delete sent messages first (references messageGenerated)
    const deletedSentMessages = await prisma.messageSent.deleteMany();

    // 2. Delete generated messages (references postRaw)
    const deletedGeneratedMessages = await prisma.messageGenerated.deleteMany();

    // 3. Delete classifications (references postRaw)
    const deletedClassifications = await prisma.postClassified.deleteMany();

    // 4. Delete all posts
    const deletedPosts = await prisma.postRaw.deleteMany();

    // 5. Delete system logs
    const deletedLogs = await prisma.systemLog.deleteMany();

    res.json({
      success: true,
      message: 'All data has been deleted successfully',
      deleted: {
        posts: deletedPosts.count,
        classifications: deletedClassifications.count,
        generatedMessages: deletedGeneratedMessages.count,
        sentMessages: deletedSentMessages.count,
        logs: deletedLogs.count,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to reset data:', error);
    res.status(500).json({ error: 'Failed to reset data', message });
  }
});

export default router;
