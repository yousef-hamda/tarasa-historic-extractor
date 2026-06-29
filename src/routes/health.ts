import { Request, Response, Router } from 'express';
import { checkDatabaseConnection } from '../database/prisma';
import { getCookieHealth } from '../facebook/session';
import { loadSessionHealth } from '../session/sessionHealth';
import { getScrapingStatus } from '../scraper/orchestrator';

const router = Router();

// Per-check timeout so a slow/hung dependency (DB, fs, an FD-starved process)
// can NEVER make the health endpoint hang past the dashboard's request timeout.
// Each check resolves to a safe fallback on timeout OR rejection; the endpoint
// then reports "degraded/unhealthy" instead of leaving the client to time out.
const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS) || 4000;

const withTimeout = async <T>(p: Promise<T>, fallback: T, ms = CHECK_TIMEOUT_MS): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(p).catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// Safe "everything-down" fallbacks for when a check times out or rejects.
const COOKIE_FALLBACK: Awaited<ReturnType<typeof getCookieHealth>> = {
  ok: false,
  total: 0,
  valid: 0,
  hasSession: false,
  userId: null,
};
const SESSION_FALLBACK: Awaited<ReturnType<typeof loadSessionHealth>> = {
  status: 'unknown',
  lastChecked: new Date().toISOString(),
  lastValid: null,
  userId: null,
  userName: null,
  errorMessage: null,
  expiresAt: null,
  canAccessPrivateGroups: false,
};

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: boolean;
    facebookSession: boolean;
    openaiKey: boolean;
    apifyToken: boolean;
  };
  session?: {
    status: string;
    userId: string | null;
    userName: string | null;
    lastChecked: string;
    canAccessPrivateGroups: boolean;
  };
  groups?: {
    total: number;
    public: number;
    private: number;
    accessible: number;
  };
  uptime: number;
}

// Main health check handler
const healthCheckHandler = async (_req: Request, res: Response) => {
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const hasApifyToken = Boolean(process.env.APIFY_TOKEN);

  // Run every check in parallel, each bounded by withTimeout so the whole
  // endpoint returns in <= CHECK_TIMEOUT_MS even if a dependency is wedged.
  const [dbConnected, cookies, sessionHealth, scrapingStatus] = await Promise.all([
    withTimeout(checkDatabaseConnection(), false),
    withTimeout(getCookieHealth(), COOKIE_FALLBACK),
    withTimeout(loadSessionHealth(), SESSION_FALLBACK),
    withTimeout(getScrapingStatus(), {
      groups: [],
      sessionValid: false,
      apifyConfigured: hasApifyToken,
      mbasicAvailable: false,
    } as Awaited<ReturnType<typeof getScrapingStatus>>),
  ]);

  // Session is valid if either cookies are ok OR session manager says valid
  const hasValidSession = cookies.ok || sessionHealth.status === 'valid';

  // Determine overall status
  // - ok: everything works
  // - degraded: can work but with limitations (e.g., no Facebook session but Apify available)
  // - unhealthy: critical services down
  let status: 'ok' | 'degraded' | 'unhealthy' = 'ok';

  if (!dbConnected) {
    status = 'unhealthy';
  } else if (!hasValidSession && !hasApifyToken) {
    // No Facebook session AND no Apify = can't scrape at all
    status = 'unhealthy';
  } else if (!hasValidSession || !hasOpenAiKey) {
    status = 'degraded';
  }

  const health: HealthStatus = {
    status,
    timestamp: new Date().toISOString(),
    checks: {
      database: dbConnected,
      facebookSession: hasValidSession,
      openaiKey: hasOpenAiKey,
      apifyToken: hasApifyToken,
    },
    session: {
      status: sessionHealth.status,
      userId: null,
      userName: null,
      lastChecked: sessionHealth.lastChecked,
      canAccessPrivateGroups: sessionHealth.canAccessPrivateGroups,
    },
    groups: {
      total: scrapingStatus.groups.length,
      public: scrapingStatus.groups.filter((g) => g.groupType === 'public').length,
      private: scrapingStatus.groups.filter((g) => g.groupType === 'private').length,
      accessible: scrapingStatus.groups.filter((g) => g.isAccessible).length,
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
  const [dbConnected, cookies, sessionHealth] = await Promise.all([
    withTimeout(checkDatabaseConnection(), false),
    withTimeout(getCookieHealth(), COOKIE_FALLBACK),
    withTimeout(loadSessionHealth(), SESSION_FALLBACK),
  ]);
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
  const hasApifyToken = Boolean(process.env.APIFY_TOKEN);

  // Ready if DB is up, OpenAI is configured, and we have some way to scrape
  const hasValidSession = cookies.ok || sessionHealth.status === 'valid';
  const canScrape = hasValidSession || hasApifyToken;

  if (dbConnected && hasOpenAiKey && canScrape) {
    res.json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      capabilities: {
        publicGroups: hasApifyToken,
        privateGroups: hasValidSession,
      },
    });
  } else {
    res.status(503).json({
      status: 'not_ready',
      reason: !dbConnected
        ? 'database_unavailable'
        : !hasOpenAiKey
        ? 'openai_key_missing'
        : 'no_scraping_method_available',
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
