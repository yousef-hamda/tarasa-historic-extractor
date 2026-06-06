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
import { stealthRefreshFacebookSession } from '../facebook/session';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import prisma from '../database/prisma';
import { reactivateAllGroups } from '../scraper/groupRegistry';
import { isLocked, withLock } from '../utils/cronLock';

const router = Router();

/**
 * Called whenever the Facebook session has just been restored (credentials
 * renewal OR manual cookie upload). Two side effects, both best-effort and
 * fire-and-forget so they never delay the HTTP response:
 *   1. Re-arm every enabled group (clear the inaccessible/error state a prior
 *      down period left behind) so the Groups page reconnects immediately.
 *   2. Kick a single background scrape (guarded by the same `scrape` lock the
 *      cron uses) so fresh posts start flowing right away instead of waiting
 *      for the next cron tick.
 */
const onSessionRestored = async (): Promise<void> => {
  try {
    await reactivateAllGroups();
  } catch (e) {
    logger.warn(`[Session] reactivateAllGroups after restore failed: ${(e as Error).message}`);
  }
  // Fire-and-forget scrape — don't await, don't double-run if one's in flight.
  (async () => {
    try {
      if (await isLocked('scrape')) return;
      const { scrapeAllGroups } = await import('../scraper/scrapeApifyToDb');
      await withLock('scrape', async () => {
        await scrapeAllGroups();
      });
      logger.info('[Session] Post-restore scrape completed');
    } catch (e) {
      logger.warn(`[Session] Post-restore scrape failed: ${(e as Error).message}`);
    }
  })();
};

// Module-level state tracking the (at most one) in-flight headless renewal.
// We don't put this in the DB because it's purely process-local and only
// meaningful while the request that started it is still hot.
interface RenewalState {
  running: boolean;
  startedAt?: Date;
  finishedAt?: Date;
  lastError?: string;
  /** The kind of challenge Facebook threw, when applicable. Lets the dashboard
   *  know to prompt for a 2FA code vs. surface the manual cookie fallback. */
  challenge?: 'captcha' | '2fa' | 'checkpoint' | null;
  userId?: string | null;
  requiresManualUpload?: boolean;
}
const renewalState: RenewalState = { running: false };

/**
 * GET /api/session/status
 * Get current session status (public). Also reports any in-flight or recent
 * renewal job so the dashboard can poll this endpoint instead of waiting on
 * a long-running POST /api/session/renew (which Railway's proxy would 504).
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
      renewal: {
        running: renewalState.running,
        startedAt: renewalState.startedAt ?? null,
        finishedAt: renewalState.finishedAt ?? null,
        lastError: renewalState.lastError ?? null,
        challenge: renewalState.challenge ?? null,
        userId: renewalState.userId ?? null,
        requiresManualUpload: renewalState.requiresManualUpload ?? false,
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
 * Async one-click auto-login. Returns 202 IMMEDIATELY and runs the headless
 * login in the background — Railway's edge proxy would 504 a synchronous
 * call that takes >60s, so we hand the work off and let the dashboard poll
 * GET /api/session/status to see when it finishes.
 */
router.post(
  '/api/session/renew',
  triggerRateLimiter,
  async (req: Request, res: Response) => {
    if (renewalState.running) {
      return res.status(409).json({
        success: false,
        error: 'Renewal already in progress',
        message: 'A renewal is already running. Wait a moment and poll /api/session/status.',
        running: true,
        startedAt: renewalState.startedAt,
      });
    }

    // Credentials supplied by the dashboard modal. All fields are optional —
    // an empty body still works (cron jobs hit this with no body and fall
    // through to env vars FB_EMAIL / FB_PASSWORD / FB_TOTP_SECRET).
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const reqEmail = typeof body.email === 'string' ? body.email : undefined;
    const reqPassword = typeof body.password === 'string' ? body.password : undefined;
    const reqTotpCode = typeof body.totpCode === 'string' ? body.totpCode : undefined;

    renewalState.running = true;
    renewalState.startedAt = new Date();
    renewalState.finishedAt = undefined;
    renewalState.lastError = undefined;
    renewalState.challenge = undefined;
    renewalState.userId = undefined;
    renewalState.requiresManualUpload = undefined;

    logger.info('[Session] Auto-renewal kicked off (async)');
    await logSystemEvent(
      'auth',
      reqEmail ? 'Auto-renewal triggered (credentials from dashboard)' : 'Auto-renewal triggered (env vars)'
    );

    // Send the response NOW so the proxy doesn't time out.
    res.status(202).json({
      success: true,
      message: 'Renewal started. Poll /api/session/status to check progress.',
      running: true,
      startedAt: renewalState.startedAt,
    });

    // Background work — fire-and-forget. Hard-capped so a stuck headless
    // Chromium can't permanently pin renewalState.running=true (which would
    // block every future renewal attempt with HTTP 409).
    //
    // We use STEALTH login only — plain Chromium is detected as a bot by FB
    // in <1s, and the plain refresh follows the exact same login flow, so
    // falling back to it just doubles the runtime without changing the
    // outcome. Stealth detects challenges (2FA / captcha / checkpoint) and
    // returns informative errors the dashboard can surface.
    const HARD_TIMEOUT_MS = 200_000;
    (async () => {
      try {
        const result = await Promise.race([
          stealthRefreshFacebookSession({
            email: reqEmail,
            password: reqPassword,
            totpCode: reqTotpCode,
          }),
          new Promise<{ success: false; error: string; challenge?: null; userId?: undefined }>(
            (_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      `Auto-renewal timed out after ${HARD_TIMEOUT_MS / 1000}s — Facebook likely showed a challenge.`
                    )
                  ),
                HARD_TIMEOUT_MS
              )
          ),
        ]);

        if (result.success) {
          await checkAndUpdateSession();
          renewalState.userId = result.userId ?? null;
          logger.info('[Session] Auto-renewal succeeded');
          await logSystemEvent('auth', 'Auto-renewal succeeded');
          // Reconnect groups + kick an immediate scrape now that we're back in.
          await onSessionRestored();
        } else {
          const err = result.error || 'Unknown error';
          renewalState.lastError = err;
          renewalState.challenge = result.challenge ?? null;
          // 2FA isn't really "needs manual upload" — it just needs another
          // try with the code. Only flag manual-upload for the unrecoverable
          // server-side cases (captcha / checkpoint / persistent failure).
          renewalState.requiresManualUpload =
            result.challenge === 'captcha' ||
            result.challenge === 'checkpoint' ||
            /captcha|checkpoint|security check/i.test(err);
          logger.warn(`[Session] Auto-renewal failed: ${err}`);
          await logSystemEvent('error', `Auto-renewal failed: ${err}`);
        }
      } catch (bgErr) {
        const message = bgErr instanceof Error ? bgErr.message : 'Unknown error';
        renewalState.lastError = message;
        renewalState.requiresManualUpload = true;
        logger.error(`[Session] Auto-renewal threw: ${message}`);
        await logSystemEvent('error', `Auto-renewal threw: ${message}`).catch(() => undefined);
      } finally {
        renewalState.running = false;
        renewalState.finishedAt = new Date();
      }
    })();
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

    // Mirror to DB so cookies survive Railway redeploys (which wipe the
    // container filesystem). Best-effort — file write is the primary path.
    try {
      const { persistCookiesArrayToDb } = await import('../facebook/session');
      await persistCookiesArrayToDb(normalized as never);
    } catch (e) {
      logger.warn(`[Session] DB cookie mirror failed (cookies still saved on disk): ${(e as Error).message}`);
    }

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

    // Session restored via manual cookie paste — reconnect groups + kick a scrape.
    await onSessionRestored();

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
