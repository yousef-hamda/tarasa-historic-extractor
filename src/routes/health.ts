import { Request, Response, Router } from 'express';
import { checkDatabaseConnection } from '../database/prisma';
import { getCookieHealth } from '../facebook/session';

const router = Router();

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: boolean;
    facebookSession: boolean;
    openaiKey: boolean;
    apifyToken: boolean;
  };
  facebook?: {
    hasSession: boolean;
    userId: string | null;
  };
  uptime: number;
}

// Main health check handler
const healthCheckHandler = async (_req: Request, res: Response) => {
  const dbConnected = await checkDatabaseConnection();
  const cookies = await getCookieHealth();
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const hasApifyToken = Boolean(process.env.APIFY_TOKEN);

  // Determine overall status
  // - ok: everything works
  // - degraded: can work but with limitations (e.g., no Facebook session but Apify available)
  // - unhealthy: critical services down
  let status: 'ok' | 'degraded' | 'unhealthy' = 'ok';

  if (!dbConnected) {
    status = 'unhealthy';
  } else if (!cookies.ok && !hasApifyToken) {
    // No Facebook session AND no Apify = can't scrape at all
    status = 'unhealthy';
  } else if (!cookies.ok || !hasOpenAiKey) {
    status = 'degraded';
  }

  const health: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    checks: {
      database: dbConnected,
      facebookSession: cookies.ok,
      openaiKey: hasOpenAiKey,
      apifyToken: hasApifyToken,
    },
    facebook: {
      hasSession: cookies.hasSession,
      userId: cookies.userId,
    },
    uptime: process.uptime(),
  };

  const statusCode = status === 'ok' ? 200 : status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
};

// Support both /health and /api/health for convenience
router.get('/health', healthCheckHandler);
router.get('/api/health', healthCheckHandler);

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
