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
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    let record = store.get(key);

    if (!record || record.resetTime < now) {
      record = { count: 1, resetTime: now + windowMs };
      store.set(key, record);
      return next();
    }

    record.count++;

    if (record.count > maxRequests) {
      logger.warn(`Rate limit exceeded for ${key} on ${req.method} ${req.path}`);
      res.setHeader('Retry-After', Math.ceil((record.resetTime - now) / 1000));
      return res.status(429).json({ error: 'Too Many Requests', message });
    }

    next();
  };
};

// Pre-configured rate limiters
export const triggerRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 5,
  message: 'Too many trigger requests. Please wait before trying again.',
});

export const apiRateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute
  maxRequests: 100,
  message: 'Too many API requests. Please slow down.',
});
