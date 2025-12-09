import { Request, Response, Router } from 'express';
import { checkDatabaseConnection } from '../database/prisma';

const router = Router();

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: boolean;
  };
  uptime: number;
}

router.get('/api/health', async (_req: Request, res: Response) => {
  const dbConnected = await checkDatabaseConnection();

  const health: HealthStatus = {
    status: dbConnected ? 'ok' : 'unhealthy',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbConnected,
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
  const dbConnected = await checkDatabaseConnection();

  if (dbConnected) {
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'not_ready', reason: 'database_unavailable', timestamp: new Date().toISOString() });
  }
});

export default router;
