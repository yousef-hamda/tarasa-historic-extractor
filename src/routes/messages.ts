import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';

const router = Router();

router.get('/api/messages', async (_req: Request, res: Response) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [queue, sent, sentLast24h] = await Promise.all([
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
    prisma.messageSent.count({
      where: { sentAt: { gte: since }, status: 'sent' },
    }),
  ]);

  res.json({
    queue,
    sent,
    stats: {
      queue: queue.length,
      sentLast24h,
    },
  });
});

export default router;
