import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';

const router = Router();

router.get('/api/logs', async (_req: Request, res: Response) => {
  const logs = await prisma.systemLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json(logs);
});

export default router;
