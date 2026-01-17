/**
 * Security Middleware
 *
 * Implements:
 * - Helmet.js security headers
 * - Advanced rate limiting with Redis
 * - Request sanitization
 * - CORS hardening
 */

import helmet from 'helmet';
import { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory, RateLimiterRes } from 'rate-limiter-flexible';
import { getRedisClient, isRedisAvailable } from '../config/redis';
import logger from '../utils/logger';

// ============================================
// Helmet Security Headers
// ============================================

/**
 * Configure Helmet with production-ready settings
 */
export const securityHeaders = helmet({
  // Content Security Policy
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Needed for Next.js
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'wss:', 'https://api.openai.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },

  // Prevent clickjacking
  frameguard: { action: 'deny' },

  // Hide X-Powered-By header
  hidePoweredBy: true,

  // Strict Transport Security (HTTPS only)
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },

  // Prevent MIME type sniffing
  noSniff: true,

  // XSS filter
  xssFilter: true,

  // Referrer policy
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

  // Permissions policy
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
});

// ============================================
// Advanced Rate Limiting
// ============================================

const RATE_LIMIT_POINTS = parseInt(process.env.TRIGGER_RATE_LIMIT_PER_MINUTE || '30', 10);
const RATE_LIMIT_DURATION = 60; // 1 minute
const RATE_LIMIT_BLOCK_DURATION = 60 * 5; // 5 minutes block after too many requests

// Fallback to memory if Redis unavailable
let rateLimiter: RateLimiterRedis | RateLimiterMemory;

/**
 * Initialize rate limiter (call after Redis is connected)
 */
export function initRateLimiter(): void {
  const redis = getRedisClient();

  if (redis && isRedisAvailable()) {
    rateLimiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'rl',
      points: RATE_LIMIT_POINTS,
      duration: RATE_LIMIT_DURATION,
      blockDuration: RATE_LIMIT_BLOCK_DURATION,
      // Insurance limiter in memory for Redis failures
      insuranceLimiter: new RateLimiterMemory({
        points: RATE_LIMIT_POINTS,
        duration: RATE_LIMIT_DURATION,
      }),
    });
    logger.info('Rate limiter: Using Redis backend');
  } else {
    rateLimiter = new RateLimiterMemory({
      points: RATE_LIMIT_POINTS,
      duration: RATE_LIMIT_DURATION,
      blockDuration: RATE_LIMIT_BLOCK_DURATION,
    });
    logger.info('Rate limiter: Using memory backend (Redis unavailable)');
  }
}

// Initialize with memory by default
initRateLimiter();

/**
 * Rate limiting middleware
 */
export const advancedRateLimiter = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Skip rate limiting for health checks (all variants)
  if (req.path === '/api/health' || req.path === '/health' || req.path.startsWith('/api/health/')) {
    return next();
  }

  // Skip rate limiting for localhost in development mode
  // This prevents the dashboard from being rate limited during development
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const isLocalhost = clientIp === '::1' || clientIp === '127.0.0.1' || clientIp === '::ffff:127.0.0.1';
  const isDevelopment = process.env.NODE_ENV !== 'production';

  if (isLocalhost && isDevelopment) {
    return next();
  }

  // Use IP + API key if available for more granular limiting
  const key = req.headers['x-api-key']
    ? `api:${req.headers['x-api-key']}`
    : `ip:${clientIp}`;

  try {
    const rateLimiterRes = await rateLimiter.consume(key);

    // Add rate limit headers
    res.set({
      'X-RateLimit-Limit': RATE_LIMIT_POINTS.toString(),
      'X-RateLimit-Remaining': rateLimiterRes.remainingPoints.toString(),
      'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
    });

    next();
  } catch (rateLimiterRes) {
    if (rateLimiterRes instanceof RateLimiterRes) {
      const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000);

      res.set({
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': RATE_LIMIT_POINTS.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
      });

      logger.warn(`Rate limit exceeded for ${key}`);

      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Retry after ${retryAfter} seconds.`,
        retryAfter,
      });
    } else {
      // Redis error - allow request but log
      logger.error(`Rate limiter error: ${rateLimiterRes}`);
      next();
    }
  }
};

// ============================================
// Brute Force Protection
// ============================================

const bruteForceProtection = new RateLimiterMemory({
  points: 5, // 5 failed attempts
  duration: 60 * 15, // 15 minutes
  blockDuration: 60 * 60, // Block for 1 hour
});

/**
 * Brute force protection for sensitive endpoints
 */
export const bruteForceMiddleware = (pointsToConsume = 1) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `bf:${req.ip || req.socket.remoteAddress || 'unknown'}`;

    try {
      await bruteForceProtection.consume(key, pointsToConsume);
      next();
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        const retryAfter = Math.ceil(error.msBeforeNext / 1000);
        logger.warn(`Brute force protection triggered for ${key}`);

        res.status(429).json({
          error: 'Too Many Attempts',
          message: 'Too many failed attempts. Please try again later.',
          retryAfter,
        });
      } else {
        next();
      }
    }
  };
};

/**
 * Reset brute force counter on successful auth
 */
export async function resetBruteForce(ip: string): Promise<void> {
  try {
    await bruteForceProtection.delete(`bf:${ip}`);
  } catch {
    // Ignore errors
  }
}

// ============================================
// Request Sanitization
// ============================================

/**
 * Sanitize request body to prevent injection attacks
 */
export const sanitizeRequest = (req: Request, res: Response, next: NextFunction): void => {
  // Limit body size
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  const maxBodySize = 1024 * 1024; // 1MB

  if (contentLength > maxBodySize) {
    res.status(413).json({
      error: 'Payload Too Large',
      message: `Request body must be less than ${maxBodySize / 1024}KB`,
    });
    return;
  }

  // Remove potentially dangerous keys from body (prototype pollution protection)
  if (req.body && typeof req.body === 'object') {
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    const sanitize = (obj: Record<string, unknown>): void => {
      // Use getOwnPropertyNames to catch __proto__ as a literal property
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (dangerousKeys.includes(key)) {
          delete obj[key];
        } else if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          sanitize(obj[key] as Record<string, unknown>);
        }
      }
    };
    sanitize(req.body);
  }

  next();
};

// ============================================
// CORS Configuration
// ============================================

/**
 * Generate CORS options from environment
 */
export function getCorsOptions() {
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        logger.warn(`CORS blocked origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours
  };
}

export default {
  securityHeaders,
  advancedRateLimiter,
  bruteForceMiddleware,
  resetBruteForce,
  sanitizeRequest,
  getCorsOptions,
  initRateLimiter,
};
