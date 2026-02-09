/**
 * Comprehensive tests for rate limiter middleware
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createRateLimiter, triggerRateLimiter, apiRateLimiter } from '../src/middleware/rateLimiter';
import logger from '../src/utils/logger';

describe('createRateLimiter()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const createMockRequest = (ip: string = '192.168.1.1', method: string = 'GET', path: string = '/api/test'): Partial<Request> => ({
    ip,
    method,
    path,
    socket: { remoteAddress: ip } as any,
  });

  const createMockResponse = (): Partial<Response> & { statusCode?: number; jsonData?: any; headers: Record<string, string> } => {
    const res: any = {
      headers: {},
      statusCode: 200,
      jsonData: null,
      status: vi.fn(function(code: number) {
        res.statusCode = code;
        return res;
      }),
      json: vi.fn(function(data: any) {
        res.jsonData = data;
        return res;
      }),
      setHeader: vi.fn(function(name: string, value: string) {
        res.headers[name] = value;
        return res;
      }),
    };
    return res;
  };

  describe('basic rate limiting', () => {
    it('should allow requests under the limit', () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 5 });
      const req = createMockRequest('10.0.0.1');
      const res = createMockResponse();
      const next = vi.fn();

      // Make 5 requests - all should pass
      for (let i = 0; i < 5; i++) {
        limiter(req as Request, res as Response, next as NextFunction);
      }

      expect(next).toHaveBeenCalledTimes(5);
    });

    it('should block requests over the limit', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 3 });
      const req = createMockRequest('10.0.0.2');
      const res = createMockResponse();
      const next = vi.fn();

      // Make 4 requests - first 3 should pass, 4th should be blocked
      for (let i = 0; i < 4; i++) {
        limiter(req as Request, res as Response, next as NextFunction);
      }

      expect(next).toHaveBeenCalledTimes(3);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('should return custom error message', () => {
      process.env.NODE_ENV = 'production';
      const customMessage = 'Custom rate limit message';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1, message: customMessage });
      const req = createMockRequest('10.0.0.3');
      const res = createMockResponse();
      const next = vi.fn();

      // First request passes
      limiter(req as Request, res as Response, next as NextFunction);
      // Second request blocked
      limiter(req as Request, res as Response, next as NextFunction);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: customMessage,
        })
      );
    });

    it('should use default message when not provided', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const req = createMockRequest('10.0.0.4');
      const res = createMockResponse();
      const next = vi.fn();

      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Too many requests, please try again later',
        })
      );
    });

    it('should set Retry-After header when blocked', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const req = createMockRequest('10.0.0.5');
      const res = createMockResponse();
      const next = vi.fn();

      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });
  });

  describe('IP handling', () => {
    it('should use req.ip when available', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const req = createMockRequest('192.168.1.100');
      const res = createMockResponse();
      const next = vi.fn();

      // Same IP should be tracked together
      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(2);
    });

    it('should use socket.remoteAddress as fallback', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const req: Partial<Request> = {
        ip: undefined as any,
        method: 'GET',
        path: '/api/test',
        socket: { remoteAddress: '10.10.10.10' } as any,
      };
      const res = createMockResponse();
      const next = vi.fn();

      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(2);
    });

    it('should handle unknown IP', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const req: Partial<Request> = {
        ip: undefined as any,
        method: 'GET',
        path: '/api/test',
        socket: {} as any,
      };
      const res = createMockResponse();
      const next = vi.fn();

      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(2);
    });

    it('should track different IPs separately', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const req1 = createMockRequest('10.0.0.100');
      const req2 = createMockRequest('10.0.0.200');
      const res = createMockResponse();
      const next = vi.fn();

      // 2 requests from IP1
      limiter(req1 as Request, res as Response, next as NextFunction);
      limiter(req1 as Request, res as Response, next as NextFunction);

      // 2 requests from IP2 (should have its own counter)
      limiter(req2 as Request, res as Response, next as NextFunction);
      limiter(req2 as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(4);
    });
  });

  describe('localhost exemption in development', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'development';
    });

    it('should skip rate limiting for ::1 in development', () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const req = createMockRequest('::1');
      const res = createMockResponse();
      const next = vi.fn();

      // Make many requests - all should pass
      for (let i = 0; i < 10; i++) {
        limiter(req as Request, res as Response, next as NextFunction);
      }

      expect(next).toHaveBeenCalledTimes(10);
    });

    it('should skip rate limiting for 127.0.0.1 in development', () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const req = createMockRequest('127.0.0.1');
      const res = createMockResponse();
      const next = vi.fn();

      for (let i = 0; i < 10; i++) {
        limiter(req as Request, res as Response, next as NextFunction);
      }

      expect(next).toHaveBeenCalledTimes(10);
    });

    it('should skip rate limiting for ::ffff:127.0.0.1 in development', () => {
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const req = createMockRequest('::ffff:127.0.0.1');
      const res = createMockResponse();
      const next = vi.fn();

      for (let i = 0; i < 10; i++) {
        limiter(req as Request, res as Response, next as NextFunction);
      }

      expect(next).toHaveBeenCalledTimes(10);
    });

    it('should NOT skip for localhost in production', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
      const req = createMockRequest('127.0.0.1');
      const res = createMockResponse();
      const next = vi.fn();

      for (let i = 0; i < 5; i++) {
        limiter(req as Request, res as Response, next as NextFunction);
      }

      expect(next).toHaveBeenCalledTimes(2);
    });
  });

  describe('window expiration', () => {
    it('should reset counter after window expires', async () => {
      process.env.NODE_ENV = 'production';
      vi.useFakeTimers();

      const limiter = createRateLimiter({ windowMs: 1000, maxRequests: 2 });
      const req = createMockRequest('10.0.0.50');
      const res = createMockResponse();
      const next = vi.fn();

      // Use up the limit
      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(2);

      // Advance time past the window
      vi.advanceTimersByTime(1100);

      // Should be able to make requests again
      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(4);

      vi.useRealTimers();
    });
  });

  describe('logging', () => {
    it('should log warning when rate limit exceeded', () => {
      process.env.NODE_ENV = 'production';
      const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1 });
      const req = createMockRequest('10.0.0.60');
      (req as any).method = 'POST';
      (req as any).path = '/api/action';
      const res = createMockResponse();
      const next = vi.fn();

      limiter(req as Request, res as Response, next as NextFunction);
      limiter(req as Request, res as Response, next as NextFunction);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded for 10.0.0.60 on POST /api/action')
      );
    });
  });
});

describe('triggerRateLimiter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should be a function', () => {
    expect(typeof triggerRateLimiter).toBe('function');
  });

  it('should have default rate limit', () => {
    // The triggerRateLimiter is pre-configured with environment-based limit
    expect(triggerRateLimiter).toBeDefined();
  });

  it('should call next for valid request', () => {
    const req: Partial<Request> = {
      ip: '10.20.30.40',
      method: 'POST',
      path: '/api/trigger',
      socket: { remoteAddress: '10.20.30.40' } as any,
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    triggerRateLimiter(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
  });
});

describe('apiRateLimiter', () => {
  it('should be a function', () => {
    expect(typeof apiRateLimiter).toBe('function');
  });

  it('should be defined', () => {
    expect(apiRateLimiter).toBeDefined();
  });

  it('should call next for valid request', () => {
    const req: Partial<Request> = {
      ip: '10.20.30.50',
      method: 'GET',
      path: '/api/status',
      socket: { remoteAddress: '10.20.30.50' } as any,
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    apiRateLimiter(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalled();
  });
});

describe('Rate limiter edge cases', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should handle maxRequests of 0', () => {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 0 });
    const req: Partial<Request> = {
      ip: '10.0.0.70',
      method: 'GET',
      path: '/api/test',
      socket: { remoteAddress: '10.0.0.70' } as any,
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    // First request initializes the record and passes (count becomes 1)
    limiter(req as Request, res as Response, next as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);

    // Second request should be blocked (count > maxRequests: 1 > 0)
    limiter(req as Request, res as Response, next as NextFunction);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('should handle very large maxRequests', () => {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 1000000 });
    const req: Partial<Request> = {
      ip: '10.0.0.80',
      method: 'GET',
      path: '/api/test',
      socket: { remoteAddress: '10.0.0.80' } as any,
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    // Should allow many requests
    for (let i = 0; i < 100; i++) {
      limiter(req as Request, res as Response, next as NextFunction);
    }

    expect(next).toHaveBeenCalledTimes(100);
  });

  it('should handle very short window', () => {
    vi.useFakeTimers();
    const limiter = createRateLimiter({ windowMs: 1, maxRequests: 1 });
    const req: Partial<Request> = {
      ip: '10.0.0.90',
      method: 'GET',
      path: '/api/test',
      socket: { remoteAddress: '10.0.0.90' } as any,
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    limiter(req as Request, res as Response, next as NextFunction);
    vi.advanceTimersByTime(2);
    limiter(req as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('should handle requests with different methods from same IP', () => {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
    const req1: Partial<Request> = {
      ip: '10.0.0.91',
      method: 'GET',
      path: '/api/test',
      socket: { remoteAddress: '10.0.0.91' } as any,
    };
    const req2: Partial<Request> = {
      ip: '10.0.0.91',
      method: 'POST',
      path: '/api/test',
      socket: { remoteAddress: '10.0.0.91' } as any,
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    // Same IP, different methods - should count together
    limiter(req1 as Request, res as Response, next as NextFunction);
    limiter(req2 as Request, res as Response, next as NextFunction);
    limiter(req1 as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it('should handle requests with different paths from same IP', () => {
    const limiter = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
    const req1: Partial<Request> = {
      ip: '10.0.0.92',
      method: 'GET',
      path: '/api/users',
      socket: { remoteAddress: '10.0.0.92' } as any,
    };
    const req2: Partial<Request> = {
      ip: '10.0.0.92',
      method: 'GET',
      path: '/api/posts',
      socket: { remoteAddress: '10.0.0.92' } as any,
    };
    const res: Partial<Response> = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    // Same IP, different paths - should count together
    limiter(req1 as Request, res as Response, next as NextFunction);
    limiter(req2 as Request, res as Response, next as NextFunction);
    limiter(req1 as Request, res as Response, next as NextFunction);

    expect(next).toHaveBeenCalledTimes(2);
  });
});

console.log('Rate limiter test suite loaded');
