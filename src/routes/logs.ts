import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { parsePositiveInt, parseNonNegativeInt, sanitizeLogType } from '../utils/validation';

const router = Router();

router.get('/api/logs', async (req: Request, res: Response) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 200, 500);
    const offset = parseNonNegativeInt(req.query.offset, 0);
    const type = sanitizeLogType(req.query.type);

    const where = type ? { type } : {};

    const [logs, total] = await Promise.all([
      prisma.systemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.systemLog.count({ where }),
    ]);

    res.json({
      data: logs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + logs.length < total,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch logs', message });
  }
});

export default router;
