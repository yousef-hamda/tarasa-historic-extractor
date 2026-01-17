/**
 * Session API Routes
 *
 * Endpoints for managing and monitoring the Facebook session.
 */

import { Request, Response, Router } from 'express';
import { getSessionStatus, checkAndUpdateSession } from '../session/sessionManager';
import { loadSessionHealth } from '../session/sessionHealth';
import { getScrapingStatus } from '../scraper/orchestrator';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { refreshFacebookSession } from '../facebook/session';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';

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
 * This will open a browser, verify/refresh the login, and save new cookies
 */
router.post(
  '/api/session/renew',
  triggerRateLimiter,
  async (_req: Request, res: Response) => {
    try {
      logger.info('[Session] Manual session renewal triggered');
      await logSystemEvent('auth', 'Manual session renewal triggered from dashboard');

      // Run the session refresh
      await refreshFacebookSession();

      // Get updated status
      const health = await checkAndUpdateSession();

      logger.info('[Session] Session renewal completed successfully');
      await logSystemEvent('auth', 'Manual session renewal completed successfully');

      res.json({
        success: true,
        message: 'Facebook session renewed successfully',
        session: {
          status: health.status,
          userId: health.userId,
          userName: health.userName,
          lastChecked: health.lastChecked,
          canAccessPrivateGroups: health.canAccessPrivateGroups,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`[Session] Session renewal failed: ${message}`);
      await logSystemEvent('error', `Manual session renewal failed: ${message}`);

      res.status(500).json({
        success: false,
        error: 'Session renewal failed',
        message,
        hint: message.includes('Two-factor')
          ? 'Two-factor authentication is required. Please log in manually.'
          : message.includes('Captcha')
          ? 'Facebook is showing a captcha. Please log in manually.'
          : 'Check if Facebook credentials are correct in environment variables.',
      });
    }
  }
);

export default router;
