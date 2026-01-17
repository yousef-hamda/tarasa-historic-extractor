import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const store: Map<string, RateLimitRecord> = new Map();

// Clean up expired records every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of store.entries()) {
    if (record.resetTime < now) {
      store.delete(key);
    }
  }
}, 60000);

interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  message?: string;
}

/**
 * Simple in-memory rate limiter middleware
 */
export const createRateLimiter = (options: RateLimitOptions) => {
  const { windowMs, maxRequests, message = 'Too many requests, please try again later' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    // Skip rate limiting for localhost in development mode
    const isLocalhost = clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1';
    const isDevelopment = process.env.NODE_ENV !== 'production';

    if (isLocalhost && isDevelopment) {
      return next();
    }

    const now = Date.now();
    let record = store.get(clientIp);

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + windowMs };
      store.set(clientIp, record);
      return next();
    }

    record.count++;

    if (record.count > maxRequests) {
      logger.warn(`Rate limit exceeded for ${clientIp} on ${req.method} ${req.path}`);
      res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
      return res.status(429).json({ error: 'Too Many Requests', message });
    }

    next();
  };
};

// Pre-configured rate limiters
const triggerMax = Number(process.env.TRIGGER_RATE_LIMIT_PER_MINUTE) || 30;

export const triggerRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: triggerMax,
  message: 'Too many trigger requests. Please wait before trying again.',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 500, // Increased to handle debug dashboard
  message: 'Too many API requests. Please slow down.',
});
