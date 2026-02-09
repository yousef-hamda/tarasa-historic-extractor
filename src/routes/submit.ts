/**
 * Submit Landing Page API
 *
 * Public endpoint for the pre-submission landing page that displays
 * the user's post text and allows them to copy it before redirecting to tarasa.me
 */

import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { createRateLimiter } from '../middleware/rateLimiter';
import { URLS } from '../config/constants';
import { safeErrorMessage } from '../middleware/errorHandler';

// Rate limiter for public submit endpoints to prevent ID enumeration
const submitRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 60, // 60 requests per minute per IP
  message: 'Too many requests. Please try again later.',
});

const router = Router();

/**
 * GET /api/submit/config
 * Returns the tarasa.me URL configuration for the landing page
 * NOTE: This route MUST be defined BEFORE the :postId route
 */
router.get('/api/submit/config', submitRateLimiter, async (_req: Request, res: Response) => {
  try {
    const baseTarasaUrl = process.env.BASE_TARASA_URL || URLS.DEFAULT_TARASA;

    res.json({
      tarasaUrl: baseTarasaUrl,
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get configuration',
      message: safeErrorMessage(error, 'Internal server error')
    });
  }
});

/**
 * GET /api/submit/:postId
 * Fetches post data for the landing page
 *
 * This is a public endpoint - no authentication required
 * as it's accessed by users clicking links in Facebook messages
 * Rate limited to prevent ID enumeration attacks
 */
router.get('/api/submit/:postId', submitRateLimiter, async (req: Request, res: Response) => {
  try {
    const postId = parseInt(req.params.postId, 10);

    if (isNaN(postId) || postId <= 0) {
      return res.status(400).json({
        error: 'Invalid post ID',
        message: 'Post ID must be a positive integer'
      });
    }

    const post = await prisma.postRaw.findUnique({
      where: { id: postId },
      include: {
        classified: true,
      },
    });

    if (!post) {
      return res.status(404).json({
        error: 'Post not found',
        message: 'The requested post does not exist'
      });
    }

    // Only return necessary data for the landing page
    // Don't expose sensitive fields like authorLink
    res.json({
      id: post.id,
      text: post.text,
      authorName: post.authorName || 'Anonymous',
      postUrl: post.postUrl || null,
      groupId: post.groupId,
      scrapedAt: post.scrapedAt,
      // Include classification info if available
      isHistoric: post.classified?.isHistoric ?? null,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Submit API] Error fetching post ${req.params.postId}: ${message}`);
    res.status(500).json({
      error: 'Failed to fetch post data',
      message: safeErrorMessage(error, 'Internal server error')
    });
  }
});

export default router;
