import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';

const router = Router();

router.get('/api/stats', async (_req: Request, res: Response) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    postsTotal,
    classifiedTotal,
    historicTotal,
    queueCount,
    sentLast24h,
    logsCount,
    lastScrape,
    lastMessage,
  ] = await Promise.all([
    prisma.postRaw.count(),
    prisma.postClassified.count(),
    prisma.postClassified.count({ where: { isHistoric: true } }),
    prisma.messageGenerated.count(),
    prisma.messageSent.count({ where: { sentAt: { gte: since }, status: 'sent' } }),
    prisma.systemLog.count(),
    prisma.systemLog.findFirst({ where: { type: 'scrape' }, orderBy: { createdAt: 'desc' } }),
    prisma.messageSent.findFirst({ orderBy: { sentAt: 'desc' } }),
  ]);

  res.json({
    postsTotal,
    classifiedTotal,
    historicTotal,
    queueCount,
    sentLast24h,
    logsCount,
    lastScrapeAt: lastScrape?.createdAt ?? null,
    lastMessageSentAt: lastMessage?.sentAt ?? null,
  });
});

export default router;
