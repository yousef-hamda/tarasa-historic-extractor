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
import { refreshFacebookSession } from '../facebook/session';
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
 *
 * One-click auto-login: launches a headless Chromium on the server, types the
 * FB_EMAIL / FB_PASSWORD from env, captures fresh cookies, and saves them.
 *
 * Falls through to a clear failure message when Facebook blocks the login
 * (captcha, 2FA, suspicious-activity check). In that case the dashboard
 * surfaces the cookie-upload modal as a fallback.
 */
router.post(
  '/api/session/renew',
  triggerRateLimiter,
  async (_req: Request, res: Response) => {
    try {
      logger.info('[Session] Auto-renewal triggered from dashboard');
      await logSystemEvent('auth', 'Auto-renewal triggered - launching headless browser');

      const result = await refreshFacebookSession();

      if (result.success) {
        const health = await checkAndUpdateSession();
        logger.info(`[Session] Auto-renewal succeeded for user ${health.userId}`);
        await logSystemEvent('auth', `Auto-renewal succeeded for user ${health.userId}`);

        return res.json({
          success: true,
          message: 'Facebook session renewed successfully.',
          session: {
            status: health.status,
            userId: health.userId,
            userName: health.userName,
            lastChecked: health.lastChecked,
            canAccessPrivateGroups: health.canAccessPrivateGroups,
          },
        });
      }

      // Auto-login was blocked or failed
      logger.warn(`[Session] Auto-renewal failed: ${result.error}`);
      const health = await checkAndUpdateSession();
      const err = result.error || 'Unknown error';
      const isChallenge =
        /two-factor|2fa|captcha|checkpoint|security check/i.test(err);

      return res.status(400).json({
        success: false,
        error: 'Auto-renewal failed',
        message: err,
        canRetry: !isChallenge,
        requiresManualUpload: isChallenge,
        hint: isChallenge
          ? 'Facebook is asking for a 2FA / captcha challenge that the server cannot solve. Use "Upload cookies manually" below to bypass.'
          : 'The automated login failed. You can retry, or use "Upload cookies manually" as a fallback.',
        session: {
          status: health.status,
          userId: health.userId,
          lastChecked: health.lastChecked,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Session] Auto-renewal error: ${message}`);
      await logSystemEvent('error', `Auto-renewal failed: ${message}`);

      res.status(500).json({
        success: false,
        error: 'Auto-renewal failed',
        message,
        requiresManualUpload: true,
        hint: 'Unexpected server error during automated login. Use "Upload cookies manually" below.',
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
