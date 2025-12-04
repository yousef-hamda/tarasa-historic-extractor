import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';

const router = Router();

router.get('/api/health', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

export default router;
