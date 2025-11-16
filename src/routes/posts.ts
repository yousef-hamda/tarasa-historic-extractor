import { Router } from 'express';
import prisma from '../database/prisma';

const router = Router();

router.get('/api/posts', async (_req, res) => {
  const posts = await prisma.postRaw.findMany({
    include: { classified: true },
    orderBy: { scrapedAt: 'desc' },
    take: 100,
  });
  res.json(posts);
});

router.post('/api/trigger-scrape', async (_req, res) => {
  res.json({ status: 'queued' });
});

export default router;
