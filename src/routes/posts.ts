import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { scrapeGroups } from '../scraper/scraper';
import { classifyPosts } from '../ai/classifier';
import { generateMessages } from '../ai/generator';
import { dispatchMessages } from '../messenger/messenger';
import { logSystemEvent } from '../utils/systemLog';

const router = Router();

const requireAdminKey = (req: Request) => {
  const apiKey = req.headers['x-api-key'];
  const normalizedKey = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  return normalizedKey === process.env.ADMIN_API_KEY;
};

router.get('/api/posts', async (_req: Request, res: Response) => {
  const posts = await prisma.postRaw.findMany({
    include: { classified: true },
    orderBy: { scrapedAt: 'desc' },
    take: 100,
  });
  res.json(posts);
});

router.post('/api/trigger-scrape', async (req: Request, res: Response) => {
  if (!requireAdminKey(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await scrapeGroups();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual scrape trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

router.post('/api/trigger-classification', async (req: Request, res: Response) => {
  if (!requireAdminKey(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await classifyPosts();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual classification trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

router.post('/api/trigger-message', async (req: Request, res: Response) => {
  if (!requireAdminKey(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    await generateMessages();
    await dispatchMessages();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual message trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

export default router;
