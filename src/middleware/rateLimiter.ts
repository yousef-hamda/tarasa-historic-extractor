import { Request, Response, NextFunction } from 'express';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  statusCode?: number;
  message?: string;
}

type RateRecord = {
  count: number;
  resetTime: number;
};

const ipHits = new Map<string, RateRecord>();

function cleanupExpired(now: number) {
  for (const [ip, record] of ipHits.entries()) {
    if (now > record.resetTime) {
      ipHits.delete(ip);
    }
  }
}

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, statusCode = 429, message = 'Too many requests' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    cleanupExpired(now);

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const record = ipHits.get(ip);

    if (!record || now > record.resetTime) {
      ipHits.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (record.count >= max) {
      return res.status(statusCode).json({ error: message });
    }

    record.count += 1;
    ipHits.set(ip, record);
    return next();
  };
}

export default createRateLimiter;
