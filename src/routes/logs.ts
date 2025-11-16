import { Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../database/prisma';
import { logsQuerySchema, validateQuery } from '../middleware/validation';

const router = Router();

const clampLimit = (value: number) => Math.min(Math.max(value, 10), 200);

router.get('/api/logs', validateQuery(logsQuerySchema), async (req: Request, res: Response) => {
  const limit = clampLimit(Number(req.query.limit) || 50);
  const requestedPage = Math.max(Number(req.query.page) || 1, 1);
  const typeFilter = (req.query.type as string | undefined)?.trim();
  const search = (req.query.search as string | undefined)?.trim();

  const where: Prisma.SystemLogWhereInput = {};

  if (typeFilter && typeFilter !== 'all') {
    where.type = typeFilter;
  }

  if (search) {
    where.message = { contains: search, mode: 'insensitive' };
  }

  const total = await prisma.systemLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(requestedPage, pages);
  const skip = (currentPage - 1) * limit;

  const [logs, availableTypesResult] = await Promise.all([
    prisma.systemLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.systemLog.findMany({
      select: { type: true },
      distinct: ['type'],
      orderBy: { type: 'asc' },
    }),
  ]);

  const availableTypes = availableTypesResult.map((item: { type: string }) => item.type);

  res.json({
    data: logs,
    pagination: {
      total,
      page: currentPage,
      pages,
      limit,
    },
    availableTypes,
  });
});

export default router;
