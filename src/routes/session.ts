/**
 * Session API Routes
 *
 * Endpoints for managing and monitoring the Facebook session.
 */

import { Request, Response, Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { getSessionStatus, checkAndUpdateSession } from '../session/sessionManager';
import { loadSessionHealth, markSessionValid } from '../session/sessionHealth';
import { getScrapingStatus } from '../scraper/orchestrator';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { apiKeyAuth } from '../middleware/apiAuth';
import { refreshFacebookSession, interactiveSessionRenewal } from '../facebook/session';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import prisma from '../database/prisma';

const router = Router();

/**
 * GET /api/session/status
 * Get current session status (public)
 */
router.get('/api/session/status', async (_req: Request, res: Response) => {
  try {
    const status = await getSessionStatus();
    const health = await loadSessionHealth();

    res.json({
      ...status,
      sessionHealth: {
        status: health.status,
        lastChecked: health.lastChecked,
        lastValid: health.lastValid,
        expiresAt: health.expiresAt,
        errorMessage: health.errorMessage,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get session status', message });
  }
});

/**
 * POST /api/session/validate
 * Trigger a session validation check (protected)
 */
router.post(
  '/api/session/validate',
  apiKeyAuth,
  triggerRateLimiter,
  async (_req: Request, res: Response) => {
    try {
      const health = await checkAndUpdateSession();

      res.json({
        status: health.status,
        userId: health.userId,
        userName: health.userName,
        lastChecked: health.lastChecked,
        canAccessPrivateGroups: health.canAccessPrivateGroups,
        errorMessage: health.errorMessage,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: 'Session validation failed', message });
    }
  }
);

/**
 * GET /api/session/groups
 * Get status of all configured groups
 */
router.get('/api/session/groups', async (_req: Request, res: Response) => {
  try {
    const status = await getScrapingStatus();

    res.json({
      groups: status.groups,
      summary: {
        total: status.groups.length,
        public: status.groups.filter((g) => g.groupType === 'public').length,
        private: status.groups.filter((g) => g.groupType === 'private').length,
        accessible: status.groups.filter((g) => g.isAccessible).length,
        inaccessible: status.groups.filter((g) => !g.isAccessible).length,
      },
      capabilities: {
        sessionValid: status.sessionValid,
        apifyConfigured: status.apifyConfigured,
        canScrapePublic: status.apifyConfigured,
        canScrapePrivate: status.sessionValid,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to get group status', message });
  }
});

/**
 * POST /api/session/renew
 * Manually trigger a Facebook session renewal
 * Opens a VISIBLE browser window for manual login (5 minute timeout)
 */
router.post(
  '/api/session/renew',
  triggerRateLimiter,
  async (_req: Request, res: Response) => {
    try {
      logger.info('[Session] Interactive session renewal triggered from dashboard');
      await logSystemEvent('auth', 'Interactive session renewal triggered - opening browser window');

      // Use interactive renewal which opens a VISIBLE browser
      // User has 5 minutes to complete login
      const result = await interactiveSessionRenewal(300000); // 5 minutes

      if (result.success) {
        logger.info(`[Session] Interactive renewal successful for user ${result.userId}`);

        // Get the full session status
        const health = await checkAndUpdateSession();

        res.json({
          success: true,
          message: 'Facebook session renewed successfully! You can close this notification.',
          session: {
            status: health.status,
            userId: result.userId || health.userId,
            userName: health.userName,
            lastChecked: health.lastChecked,
            canAccessPrivateGroups: health.canAccessPrivateGroups,
          },
        });
      } else {
        logger.warn(`[Session] Interactive renewal failed: ${result.error}`);

        // Get current session state
        const health = await checkAndUpdateSession();

        res.status(400).json({
          success: false,
          error: 'Session renewal failed',
          message: result.error || 'Unable to complete login',
          hint: result.error?.includes('timed out')
            ? 'Please try again and complete the login within 5 minutes.'
            : 'A browser window opened but login was not completed. Please try again.',
          session: {
            status: health.status,
            userId: health.userId,
            lastChecked: health.lastChecked,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Session] Interactive renewal error: ${message}`);
      await logSystemEvent('error', `Interactive session renewal failed: ${message}`);

      res.status(500).json({
        success: false,
        error: 'Session renewal failed',
        message,
        hint: 'An error occurred while opening the browser. Please try running: npm run fb:login',
      });
    }
  }
);

/**
 * POST /api/session/upload-cookies
 *
 * Public endpoint (no API key required) that accepts a JSON array of cookies
 * in the Cookie-Editor / Playwright format. Validates that c_user and xs are
 * present for .facebook.com, writes them to cookies.json, and marks the
 * SessionState as `valid`.
 *
 * Body: { cookies: Array<{ name, value, domain, path?, httpOnly?, secure?,
 *                          sameSite?, expirationDate? | expires? }> }
 *   — or just an array, for convenience with Cookie-Editor's clipboard format.
 */
router.post('/api/session/upload-cookies', triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    // Accept either { cookies: [...] } or just [...] for convenience
    const raw = Array.isArray(req.body) ? req.body : req.body?.cookies;

    if (!Array.isArray(raw) || raw.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payload',
        message: 'Expected a JSON array of cookies, or { "cookies": [...] }.',
      });
    }

    // Normalize the shape: Cookie-Editor uses expirationDate; Playwright uses expires.
    // Also coerce sameSite values to Playwright's accepted casing.
    type RawCookie = Record<string, unknown>;
    const normalizeSameSite = (v: unknown): 'Strict' | 'Lax' | 'None' | undefined => {
      if (typeof v !== 'string') return undefined;
      const s = v.toLowerCase();
      if (s === 'strict') return 'Strict';
      if (s === 'lax') return 'Lax';
      if (s === 'none' || s === 'no_restriction' || s === 'unspecified') return 'None';
      return undefined;
    };

    const normalized = raw
      .filter((c: unknown): c is RawCookie => Boolean(c) && typeof c === 'object')
      .map((c: RawCookie) => {
        const expires = typeof c.expirationDate === 'number'
          ? c.expirationDate
          : typeof c.expires === 'number'
            ? c.expires
            : undefined;
        return {
          name: String(c.name ?? ''),
          value: String(c.value ?? ''),
          domain: String(c.domain ?? ''),
          path: typeof c.path === 'string' ? c.path : '/',
          ...(expires !== undefined ? { expires } : {}),
          httpOnly: Boolean(c.httpOnly),
          secure: c.secure !== false,
          sameSite: normalizeSameSite(c.sameSite) ?? 'None',
        };
      })
      .filter((c) => c.name && c.value && c.domain.includes('facebook.com'));

    if (normalized.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No Facebook cookies found',
        message: 'The uploaded data did not contain any cookies for the .facebook.com domain.',
      });
    }

    const cUser = normalized.find((c) => c.name === 'c_user');
    const xs = normalized.find((c) => c.name === 'xs');

    if (!cUser || !xs) {
      return res.status(400).json({
        success: false,
        error: 'Missing required cookies',
        message: `Required Facebook session cookies are missing. Need both c_user and xs, found: ${
          [cUser && 'c_user', xs && 'xs'].filter(Boolean).join(', ') || 'none'
        }. Make sure you exported cookies while logged into Facebook.`,
      });
    }

    // Write to the same path facebook/session.ts loads from
    const cookiesPath = path.resolve(__dirname, '../config/cookies.json');
    await fs.writeFile(cookiesPath, JSON.stringify(normalized, null, 2));

    // Mark session healthy + persist user id
    await markSessionValid(cUser.value);

    try {
      const existing = await prisma.sessionState.findFirst({ orderBy: { createdAt: 'desc' } });
      const data = {
        status: 'valid' as const,
        lastChecked: new Date(),
        lastValid: new Date(),
        userId: cUser.value,
        errorMessage: null,
      };
      if (existing) {
        await prisma.sessionState.update({ where: { id: existing.id }, data });
      } else {
        await prisma.sessionState.create({ data });
      }
    } catch (dbError) {
      logger.warn(`[Session] DB update after cookie upload failed: ${(dbError as Error).message}`);
    }

    await logSystemEvent('auth', `Cookies uploaded via dashboard: user ${cUser.value}, ${normalized.length} cookies stored`);
    logger.info(`[Session] Cookies uploaded successfully for user ${cUser.value} (${normalized.length} cookies)`);

    res.json({
      success: true,
      message: 'Cookies saved. Facebook session is now valid.',
      cookieCount: normalized.length,
      userId: cUser.value,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Session] Upload cookies error: ${message}`);
    res.status(500).json({
      success: false,
      error: 'Failed to save cookies',
      message,
    });
  }
});

export default router;
