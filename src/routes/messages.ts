import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { getDailyMessageUsage } from '../utils/quota';

const router = Router();

router.get('/api/messages', async (_req: Request, res: Response) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [queue, sent, usage] = await Promise.all([
    prisma.messageGenerated.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { post: true },
    }),
    prisma.messageSent.findMany({
      orderBy: { sentAt: 'desc' },
      take: 200,
      include: { post: true },
    }),
    getDailyMessageUsage(),
  ]);

  res.json({
    queue,
    sent,
    stats: {
      queue: queue.length,
      sentLast24h: usage.sentLast24h,
      quotaRemaining: usage.remaining,
      messageLimit: usage.limit,
    },
  });
});

export default router;
