import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
// Using hybrid scraper (Apify for public groups, Playwright for private groups)
import { scrapeAllGroups } from '../scraper/scrapeApifyToDb';
import { classifyPosts } from '../ai/classifier';
import { generateMessages } from '../ai/generator';
import { dispatchMessages } from '../messenger/messenger';
import { logSystemEvent } from '../utils/systemLog';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { parsePositiveInt, parseNonNegativeInt } from '../utils/validation';

const router = Router();

router.get('/api/posts', async (req: Request, res: Response) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 100, 500);
    const offset = parseNonNegativeInt(req.query.offset, 0);

    const [posts, total] = await Promise.all([
      prisma.postRaw.findMany({
        include: { classified: true },
        orderBy: { scrapedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.postRaw.count(),
    ]);

    res.json({
      data: posts,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + posts.length < total,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch posts', message });
  }
});

router.post('/api/trigger-scrape', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    // Using hybrid scraper: Apify for public groups, Playwright fallback for private groups
    await scrapeAllGroups();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual scrape trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

router.post('/api/trigger-classification', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    await classifyPosts();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual classification trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

router.post('/api/trigger-message', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    await generateMessages();
    await dispatchMessages();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual message trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

// REMOVED: debug-scrape endpoint (was Playwright-specific)
// The Apify scraper provides better logging and doesn't need a debug endpoint

export default router;
