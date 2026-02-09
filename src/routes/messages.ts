import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { parsePositiveInt, parseNonNegativeInt } from '../utils/validation';
import { safeErrorMessage } from '../middleware/errorHandler';

const router = Router();

router.get('/api/messages', async (req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const queueLimit = parsePositiveInt(req.query.queueLimit, 50, 200);
    const sentLimit = parsePositiveInt(req.query.sentLimit, 200, 500);
    const sentOffset = parseNonNegativeInt(req.query.sentOffset, 0);

    const [queue, sent, sentLast24h, totalSent] = await Promise.all([
      prisma.messageGenerated.findMany({
        orderBy: { createdAt: 'desc' },
        take: queueLimit,
        include: { post: true },
      }),
      prisma.messageSent.findMany({
        orderBy: { sentAt: 'desc' },
        take: sentLimit,
        skip: sentOffset,
        include: { post: true },
      }),
      prisma.messageSent.count({
        where: { sentAt: { gte: since }, status: 'sent' },
      }),
      prisma.messageSent.count(),
    ]);

    res.json({
      queue,
      sent,
      stats: {
        queue: queue.length,
        sentLast24h,
      },
      pagination: {
        sentTotal: totalSent,
        sentLimit,
        sentOffset,
        hasMore: sentOffset + sent.length < totalSent,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch messages', message: safeErrorMessage(error, 'Internal server error') });
  }
});

export default router;
