import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Mock the logger before importing the module under test
vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Helper to build a fake Express request
function mockRequest(headers: Record<string, string> = {}, query: Record<string, string> = {}): Partial<Request> {
  return {
    headers,
    query,
    method: 'POST',
    path: '/api/test',
  };
}

// Helper to build a fake Express response
function mockResponse(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('apiKeyAuth middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module cache so the top-level `isDevelopment` is re-evaluated
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ------- Production mode, API_KEY configured -------

  it('returns 401 when no X-API-Key header is provided (production)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY = 'secret-key-123';

    const { apiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({});
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    apiKeyAuth(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Unauthorized' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when wrong API key is provided', async () => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY = 'secret-key-123';

    const { apiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({ 'x-api-key': 'wrong-key' });
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    apiKeyAuth(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Forbidden' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when the correct API key is provided', async () => {
    process.env.NODE_ENV = 'production';
    process.env.API_KEY = 'secret-key-123';

    const { apiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({ 'x-api-key': 'secret-key-123' });
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    apiKeyAuth(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 500 in production when API_KEY env var is not configured', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.API_KEY;

    const { apiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({ 'x-api-key': 'any-key' });
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    apiKeyAuth(req as Request, res as Response, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Server Configuration Error' }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows through with warning in development when API_KEY is not set', async () => {
    // The module reads NODE_ENV at import-time to determine isDevelopment.
    // NODE_ENV is not 'production' by default in tests, which means isDevelopment = true.
    process.env.NODE_ENV = 'development';
    delete process.env.API_KEY;

    const { apiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({});
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    apiKeyAuth(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('optionalApiKeyAuth middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('marks request as authenticated when correct key is provided', async () => {
    process.env.API_KEY = 'secret-key-123';
    const { optionalApiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({ 'x-api-key': 'secret-key-123' }) as any;
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    optionalApiKeyAuth(req as Request, res as Response, next);

    expect(req.isAuthenticated).toBe(true);
    expect(next).toHaveBeenCalled();
  });

  it('marks request as not authenticated when wrong key is provided', async () => {
    process.env.API_KEY = 'secret-key-123';
    const { optionalApiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({ 'x-api-key': 'wrong-key' }) as any;
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    optionalApiKeyAuth(req as Request, res as Response, next);

    expect(req.isAuthenticated).toBe(false);
    expect(next).toHaveBeenCalled();
  });

  it('always calls next() regardless of auth status', async () => {
    delete process.env.API_KEY;
    const { optionalApiKeyAuth } = await import('../../middleware/apiAuth');

    const req = mockRequest({}) as any;
    const res = mockResponse();
    const next = vi.fn() as NextFunction;

    optionalApiKeyAuth(req as Request, res as Response, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
