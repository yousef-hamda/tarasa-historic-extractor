import { Request, Response, Router } from 'express';
import { checkDatabaseConnection } from '../database/prisma';
import { getCookieHealth } from '../facebook/session';

const router = Router();

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: boolean;
    facebookCookies: boolean;
    openaiKey: boolean;
  };
  uptime: number;
}

router.get('/api/health', async (_req: Request, res: Response) => {
  const dbConnected = await checkDatabaseConnection();
  const cookies = await getCookieHealth();
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);

  const health: HealthStatus = {
    status: dbConnected && cookies.ok && hasOpenAiKey ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbConnected,
      facebookCookies: cookies.ok,
      openaiKey: hasOpenAiKey,
    },
    uptime: process.uptime(),
  };

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// Simple liveness probe (just checks if server is running)
router.get('/api/health/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness probe (checks if server is ready to accept traffic)
router.get('/api/health/ready', async (_req: Request, res: Response) => {
  const [dbConnected, cookies] = await Promise.all([checkDatabaseConnection(), getCookieHealth()]);
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);

  if (dbConnected && cookies.ok && hasOpenAiKey) {
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({
      status: 'not_ready',
      reason: !dbConnected ? 'database_unavailable' : !cookies.ok ? 'facebook_cookies_missing' : 'openai_key_missing',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
