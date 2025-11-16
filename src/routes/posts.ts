import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../database/prisma';
import { scrapeGroups } from '../scraper/scraper';
import { classifyPosts } from '../ai/classifier';
import { generateMessages } from '../ai/generator';
import { dispatchMessages } from '../messenger/messenger';
import { logSystemEvent } from '../utils/systemLog';
import { requireApiKey } from '../middleware/auth';
import { postsQuerySchema, validateQuery } from '../middleware/validation';

const router = Router();

const clampLimit = (value: number) => Math.min(Math.max(value, 1), 200);
const clampExportLimit = (value: number) => Math.min(Math.max(value, 1), 1000);

const buildPostsWhere = (req: Request): Prisma.PostRawWhereInput => {
  const historicFilter = (req.query.historic as string | undefined)?.toLowerCase();
  const groupFilter = (req.query.group as string | undefined)?.trim();

  const where: Prisma.PostRawWhereInput = {};

  if (groupFilter) {
    where.groupId = groupFilter;
  }

  if (historicFilter === 'pending') {
    where.classified = { is: null };
  } else if (historicFilter === 'true' || historicFilter === 'false') {
    where.classified = { is: { isHistoric: historicFilter === 'true' } };
  }

  return where;
};

router.get('/api/posts', validateQuery(postsQuerySchema), async (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit) || 50;
  const limit = clampLimit(rawLimit);
  const requestedPage = Math.max(Number(req.query.page) || 1, 1);
  const where = buildPostsWhere(req);

  const total = await prisma.postRaw.count({ where });
  const pages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(requestedPage, pages);
  const skip = (currentPage - 1) * limit;

  const posts = await prisma.postRaw.findMany({
    where,
    include: { classified: true },
    orderBy: { scrapedAt: 'desc' },
    skip,
    take: limit,
  });

  res.json({
    data: posts,
    pagination: {
      total,
      page: currentPage,
      pages,
      limit,
    },
  });
});

const csvEscape = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '""';
  }
  const normalized = String(value).replace(/"/g, '""').replace(/\r?\n/g, ' ');
  return `"${normalized}"`;
};

router.get('/api/posts/export', validateQuery(postsQuerySchema), async (req: Request, res: Response) => {
  const where = buildPostsWhere(req);
  const limit = clampExportLimit(Number(req.query.limit) || 500);

  const posts = await prisma.postRaw.findMany({
    where,
    include: { classified: true },
    orderBy: { scrapedAt: 'desc' },
    take: limit,
  });

  const header = [
    'id',
    'groupId',
    'fbPostId',
    'authorName',
    'authorLink',
    'text',
    'isHistoric',
    'confidence',
    'scrapedAt',
  ];

  const rows = posts.map((post) => [
    post.id,
    post.groupId,
    post.fbPostId,
    post.authorName ?? '',
    post.authorLink ?? '',
    post.text,
    post.classified?.isHistoric ?? '',
    post.classified?.confidence ?? '',
    post.scrapedAt.toISOString(),
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => csvEscape(cell)).join(','))
    .join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="posts-export.csv"');
  res.send(csv);
});

router.post('/api/trigger-scrape', requireApiKey, async (_req: Request, res: Response) => {
  try {
    await scrapeGroups();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual scrape trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

router.post('/api/trigger-classification', requireApiKey, async (_req: Request, res: Response) => {
  try {
    await classifyPosts();
    res.json({ status: 'completed' });
  } catch (error) {
    await logSystemEvent('error', `Manual classification trigger failed: ${(error as Error).message}`);
    res.status(500).json({ status: 'error', message: (error as Error).message });
  }
});

router.post('/api/trigger-message', requireApiKey, async (_req: Request, res: Response) => {
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
