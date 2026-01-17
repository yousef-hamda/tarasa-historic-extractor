/**
 * Security Middleware Tests
 *
 * Tests for security features including:
 * - Rate limiting
 * - Request sanitization
 * - CORS configuration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import { sanitizeRequest, getCorsOptions } from '../src/middleware/security';

// Mock request/response objects
function mockRequest(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    body: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    path: '/api/test',
    ...overrides,
  } as Request;
}

function mockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe('Security Middleware', () => {
  describe('sanitizeRequest', () => {
    it('should allow normal request body', () => {
      const req = mockRequest({
        body: { name: 'Test', value: 123 },
        headers: { 'content-length': '50' },
      });
      const res = mockResponse();
      const next = vi.fn();

      sanitizeRequest(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should reject oversized request body', () => {
      const req = mockRequest({
        body: { data: 'x' },
        headers: { 'content-length': '2000000' }, // 2MB
      });
      const res = mockResponse();
      const next = vi.fn();

      sanitizeRequest(req, res, next);

      expect(res.status).toHaveBeenCalledWith(413);
      expect(next).not.toHaveBeenCalled();
    });

    it('should remove dangerous prototype keys', () => {
      // Use JSON.parse to simulate real request body parsing
      // (object literals treat __proto__ specially, but JSON doesn't)
      const body = JSON.parse('{"name": "Test", "__proto__": {"admin": true}, "constructor": {"evil": true}}');
      const req = mockRequest({
        body,
        headers: { 'content-length': '100' },
      });
      const res = mockResponse();
      const next = vi.fn();

      sanitizeRequest(req, res, next);

      expect(next).toHaveBeenCalled();
      // After sanitization, these properties should be deleted
      expect(Object.prototype.hasOwnProperty.call(req.body, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(req.body, 'constructor')).toBe(false);
      expect(req.body.name).toBe('Test');
    });

    it('should handle nested dangerous keys', () => {
      // Use JSON.parse to simulate real request body parsing
      const body = JSON.parse('{"data": {"nested": {"__proto__": {"hack": true}, "safe": "value"}}}');
      const req = mockRequest({
        body,
        headers: { 'content-length': '100' },
      });
      const res = mockResponse();
      const next = vi.fn();

      sanitizeRequest(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(Object.prototype.hasOwnProperty.call(req.body.data.nested, '__proto__')).toBe(false);
      expect(req.body.data.nested.safe).toBe('value');
    });
  });

  describe('getCorsOptions', () => {
    beforeEach(() => {
      // Reset environment
      delete process.env.CORS_ORIGINS;
    });

    it('should use default origins when not configured', () => {
      const options = getCorsOptions();
      expect(options.credentials).toBe(true);
      expect(options.methods).toContain('GET');
      expect(options.methods).toContain('POST');
    });

    it('should allow requests with no origin', () => {
      const options = getCorsOptions();
      const callback = vi.fn();

      options.origin(undefined, callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('should allow configured origins', () => {
      process.env.CORS_ORIGINS = 'http://localhost:3000,http://example.com';
      const options = getCorsOptions();
      const callback = vi.fn();

      options.origin('http://localhost:3000', callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('should block unconfigured origins', () => {
      process.env.CORS_ORIGINS = 'http://localhost:3000';
      const options = getCorsOptions();
      const callback = vi.fn();

      options.origin('http://malicious.com', callback);

      expect(callback).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should allow all origins when configured with wildcard', () => {
      process.env.CORS_ORIGINS = '*';
      const options = getCorsOptions();
      const callback = vi.fn();

      options.origin('http://any-domain.com', callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });
  });
});
