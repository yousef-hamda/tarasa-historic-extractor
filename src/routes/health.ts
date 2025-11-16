import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { loadCookies } from '../facebook/session';

const router = Router();

router.get('/api/health', async (_req: Request, res: Response) => {
  const checks = {
    status: 'ok' as 'ok' | 'degraded' | 'down',
    timestamp: new Date().toISOString(),
    services: {
      database: false,
      openai: false,
      facebook: false,
    },
    details: {} as Record<string, string>,
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.services.database = true;
  } catch (error) {
    checks.status = 'degraded';
    checks.services.database = false;
    checks.details.database = (error as Error).message;
  }

  if (process.env.OPENAI_API_KEY) {
    checks.services.openai = true;
  } else {
    checks.status = 'degraded';
    checks.details.openai = 'OPENAI_API_KEY not configured';
  }

  try {
    const cookies = await loadCookies();
    checks.services.facebook = cookies.length > 0;
    if (!checks.services.facebook) {
      checks.details.facebook = 'No stored Facebook cookies - login required';
    }
  } catch (error) {
    checks.services.facebook = false;
    checks.details.facebook = (error as Error).message;
    checks.status = 'degraded';
  }

  res.status(checks.status === 'ok' ? 200 : 503).json(checks);
});

export default router;
