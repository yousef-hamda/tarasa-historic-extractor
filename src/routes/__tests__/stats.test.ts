import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { Express } from 'express';

// Mock logger
vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Prisma client
vi.mock('../../database/prisma', () => {
  return {
    default: {
      messageSent: { deleteMany: vi.fn().mockResolvedValue({ count: 5 }) },
      messageGenerated: { deleteMany: vi.fn().mockResolvedValue({ count: 10 }) },
      postClassified: { deleteMany: vi.fn().mockResolvedValue({ count: 20 }) },
      postRaw: { deleteMany: vi.fn().mockResolvedValue({ count: 30 }) },
      systemLog: {
        deleteMany: vi.fn().mockResolvedValue({ count: 50 }),
        create: vi.fn().mockResolvedValue({}),
      },
    },
  };
});

// Mock quota helper (used by GET /api/stats)
vi.mock('../../utils/quota', () => ({
  getDailyMessageUsage: vi.fn().mockResolvedValue({
    limit: 20,
    sentLast24h: 5,
    remaining: 15,
  }),
}));

// Mock systemLog (used by DELETE /api/data/reset)
vi.mock('../../utils/systemLog', () => ({
  logSystemEvent: vi.fn().mockResolvedValue(undefined),
}));

// Build a tiny Express app that mounts the stats router
async function buildApp(): Promise<Express> {
  const { default: statsRouter } = await import('../../routes/stats');
  const app = express();
  app.use(express.json());
  app.use(statsRouter);
  return app;
}

// Supertest-like helper using native fetch against a listening server
async function withServer(
  app: Express,
  fn: (baseUrl: string) => Promise<void>,
) {
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('DELETE /api/data/reset', () => {
  let app: Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Ensure API_KEY is set so the apiKeyAuth middleware lets us through
    process.env.API_KEY = 'test-api-key';
    app = await buildApp();
  });

  it('returns 401 without X-API-Key header', async () => {
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/data/reset`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });
  });

  it('returns 403 with wrong API key', async () => {
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/data/reset`, {
        method: 'DELETE',
        headers: { 'X-API-Key': 'wrong-key' },
      });
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Forbidden');
    });
  });

  it('returns 400 when X-Confirm-Delete header is missing', async () => {
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/data/reset`, {
        method: 'DELETE',
        headers: { 'X-API-Key': 'test-api-key' },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Confirmation required');
    });
  });

  it('returns 400 when X-Confirm-Delete has wrong value', async () => {
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/data/reset`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': 'test-api-key',
          'X-Confirm-Delete': 'yes',
        },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Confirmation required');
    });
  });

  it('successfully deletes data with correct auth + confirmation header', async () => {
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/data/reset`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': 'test-api-key',
          'X-Confirm-Delete': 'DELETE-ALL-DATA',
        },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.deleted).toEqual({
        posts: 30,
        classifications: 20,
        generatedMessages: 10,
        sentMessages: 5,
        logs: 50,
      });
    });
  });
});
