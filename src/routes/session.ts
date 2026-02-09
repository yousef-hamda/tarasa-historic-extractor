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
import { apiKeyAuth } from '../middleware/apiAuth';
import { refreshFacebookSession, interactiveSessionRenewal } from '../facebook/session';
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
  apiKeyAuth,
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

export default router;
