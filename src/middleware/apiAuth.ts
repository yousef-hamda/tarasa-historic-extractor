import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Middleware to protect trigger endpoints with API key authentication.
 * The API key should be passed in the X-API-Key header.
 * Set the API_KEY environment variable to enable authentication.
 * If API_KEY is not set, authentication is bypassed (for development).
 */
export const apiKeyAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = process.env.API_KEY;

  // If no API key is configured, skip authentication (development mode)
  if (!apiKey) {
    return next();
  }

  const providedKey = req.headers['x-api-key'];

  if (!providedKey) {
    logger.warn(`API auth failed: Missing X-API-Key header for ${req.method} ${req.path}`);
    return res.status(401).json({ error: 'Unauthorized', message: 'Missing X-API-Key header' });
  }

  if (providedKey !== apiKey) {
    logger.warn(`API auth failed: Invalid API key for ${req.method} ${req.path}`);
    return res.status(403).json({ error: 'Forbidden', message: 'Invalid API key' });
  }

  next();
};
