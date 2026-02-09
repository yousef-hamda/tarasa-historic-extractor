import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';

/** Timing-safe string comparison to prevent timing attacks */
const timingSafeCompare = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

const isDevelopment = process.env.NODE_ENV !== 'production';

/**
 * Middleware to protect trigger endpoints with API key authentication.
 * The API key should be passed in the X-API-Key header.
 *
 * SECURITY:
 * - In production: API_KEY is REQUIRED - requests will fail if not configured
 * - In development: API_KEY is optional but strongly recommended
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = process.env.API_KEY;

  // In production, API key is mandatory
  if (!apiKey) {
    if (isDevelopment) {
      // Allow in development but log a warning
      logger.warn(`[Security] API_KEY not configured - endpoint unprotected: ${req.method} ${req.path}`);
      return next();
    } else {
      // Block in production
      logger.error(`[Security] API_KEY not configured in production! Blocking request to ${req.path}`);
      return res.status(500).json({
        error: 'Server Configuration Error',
        message: 'API authentication not configured'
      });
    }
  }

  // Accept API key from header or query parameter (needed for EventSource/SSE which can't set headers)
  const providedKey = req.headers['x-api-key'] || req.query.apiKey;

  if (!providedKey) {
    logger.warn(`API auth failed: Missing X-API-Key header for ${req.method} ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing X-API-Key header' });
  }

  if (!timingSafeCompare(String(providedKey), apiKey)) {
    logger.warn(`API auth failed: Invalid API key for ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Forbidden', message: 'Invalid API key' });
  }

  next();
};

/**
 * Middleware for optional API key authentication (allows both authenticated and public access)
 * Use for endpoints that should work without auth but provide extra features with auth
 */
export const optionalApiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = process.env.API_KEY;
  const providedKey = req.headers['x-api-key'];

  // Mark request as authenticated if valid key provided
  (req as any).isAuthenticated = !!(apiKey && providedKey && timingSafeCompare(String(providedKey), apiKey));

  next();
};
