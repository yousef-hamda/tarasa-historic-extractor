/**
 * Comprehensive tests for query profiler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock event emitter - define mock inside factory
vi.mock('../src/debug/eventEmitter', () => ({
  debugEventEmitter: {
    emitDebugEvent: vi.fn(),
  },
}));

import {
  getQueryProfiles,
  getSlowQueries,
  getQueryStats,
  clearQueryProfiles,
  createQueryProfilerMiddleware,
  prismaQueryEventHandler,
  prismaErrorEventHandler,
} from '../src/debug/queryProfiler';
import { debugEventEmitter } from '../src/debug/eventEmitter';
import logger from '../src/utils/logger';

describe('getQueryProfiles()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryProfiles();
  });

  it('should return empty array when no queries', () => {
    const profiles = getQueryProfiles();
    expect(profiles).toEqual([]);
  });

  it('should return all profiles without filter', () => {
    // Add some query profiles via the handler
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'INSERT INTO posts', duration: 20 });

    const profiles = getQueryProfiles();
    expect(profiles.length).toBe(2);
  });

  it('should filter by operation type', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'INSERT INTO posts VALUES', duration: 20 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 15 });

    const selectProfiles = getQueryProfiles({ operation: 'select' });
    expect(selectProfiles.length).toBe(2);
    expect(selectProfiles.every((p) => p.operation === 'select')).toBe(true);
  });

  it('should filter by model name', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users WHERE id = 1', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts WHERE id = 1', duration: 20 });
    prismaQueryEventHandler({ query: 'SELECT * FROM users WHERE name = "test"', duration: 15 });

    const userProfiles = getQueryProfiles({ model: 'users' });
    expect(userProfiles.length).toBe(2);
    expect(userProfiles.every((p) => p.model === 'users')).toBe(true);
  });

  it('should filter slow queries', () => {
    // Fast query (below threshold)
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    // Slow query (above default 500ms threshold)
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 600 });

    const slowProfiles = getQueryProfiles({ slow: true });
    expect(slowProfiles.length).toBe(1);
    expect(slowProfiles[0].slow).toBe(true);
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 20; i++) {
      prismaQueryEventHandler({ query: `SELECT ${i} FROM users`, duration: 10 });
    }

    const limitedProfiles = getQueryProfiles({ limit: 5 });
    expect(limitedProfiles.length).toBe(5);
  });

  it('should return most recent when limited', () => {
    for (let i = 0; i < 20; i++) {
      prismaQueryEventHandler({ query: `SELECT ${i} FROM users`, duration: 10 });
    }

    const limitedProfiles = getQueryProfiles({ limit: 5 });
    // Should get the last 5 (15-19)
    expect(limitedProfiles[0].query).toContain('15');
    expect(limitedProfiles[4].query).toContain('19');
  });

  it('should combine multiple filters', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM users WHERE slow = true', duration: 600 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 600 });

    const filteredProfiles = getQueryProfiles({
      operation: 'select',
      model: 'users',
      slow: true,
    });
    expect(filteredProfiles.length).toBe(1);
  });
});

describe('getSlowQueries()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryProfiles();
  });

  it('should return empty array when no slow queries', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 20 });

    const slowQueries = getSlowQueries();
    expect(slowQueries).toEqual([]);
  });

  it('should return only slow queries', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 600 });
    prismaQueryEventHandler({ query: 'SELECT * FROM comments', duration: 700 });

    const slowQueries = getSlowQueries();
    expect(slowQueries.length).toBe(2);
    expect(slowQueries.every((q) => q.slow === true)).toBe(true);
  });

  it('should respect limit parameter', () => {
    for (let i = 0; i < 100; i++) {
      prismaQueryEventHandler({ query: `SELECT ${i} FROM slow_table`, duration: 600 });
    }

    const slowQueries = getSlowQueries(10);
    expect(slowQueries.length).toBe(10);
  });

  it('should use default limit of 50', () => {
    for (let i = 0; i < 100; i++) {
      prismaQueryEventHandler({ query: `SELECT ${i} FROM slow_table`, duration: 600 });
    }

    const slowQueries = getSlowQueries();
    expect(slowQueries.length).toBe(50);
  });
});

describe('getQueryStats()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryProfiles();
  });

  it('should return zeroed stats when no queries', () => {
    const stats = getQueryStats();

    expect(stats.totalQueries).toBe(0);
    expect(stats.slowQueries).toBe(0);
    expect(stats.avgDuration).toBe(0);
    expect(stats.byOperation).toEqual({});
    expect(stats.byModel).toEqual({});
  });

  it('should calculate total queries', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 20 });
    prismaQueryEventHandler({ query: 'SELECT * FROM comments', duration: 30 });

    const stats = getQueryStats();
    expect(stats.totalQueries).toBe(3);
  });

  it('should calculate slow queries count', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 600 });
    prismaQueryEventHandler({ query: 'SELECT * FROM comments', duration: 700 });

    const stats = getQueryStats();
    expect(stats.slowQueries).toBe(2);
  });

  it('should calculate average duration', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 100 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 200 });
    prismaQueryEventHandler({ query: 'SELECT * FROM comments', duration: 300 });

    const stats = getQueryStats();
    expect(stats.avgDuration).toBe(200);
  });

  it('should group by operation', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 100 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 200 });
    prismaQueryEventHandler({ query: 'INSERT INTO users VALUES', duration: 50 });

    const stats = getQueryStats();
    expect(stats.byOperation.select.count).toBe(2);
    expect(stats.byOperation.select.avgDuration).toBe(150);
    expect(stats.byOperation.insert.count).toBe(1);
    expect(stats.byOperation.insert.avgDuration).toBe(50);
  });

  it('should group by model', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users WHERE id = 1', duration: 100 });
    prismaQueryEventHandler({ query: 'SELECT * FROM users WHERE name = "test"', duration: 200 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts WHERE id = 1', duration: 50 });

    const stats = getQueryStats();
    expect(stats.byModel.users.count).toBe(2);
    expect(stats.byModel.users.avgDuration).toBe(150);
    expect(stats.byModel.posts.count).toBe(1);
    expect(stats.byModel.posts.avgDuration).toBe(50);
  });
});

describe('clearQueryProfiles()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryProfiles(); // Clear first to reset state
  });

  it('should clear all profiles', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM posts', duration: 20 });

    const profilesBefore = getQueryProfiles();
    expect(profilesBefore.length).toBe(2);

    clearQueryProfiles();

    const profilesAfter = getQueryProfiles();
    expect(profilesAfter.length).toBe(0);
  });

  it('should reset stats', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });

    clearQueryProfiles();

    const stats = getQueryStats();
    expect(stats.totalQueries).toBe(0);
  });
});

describe('createQueryProfilerMiddleware()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryProfiles();
  });

  it('should return a middleware function', () => {
    const middleware = createQueryProfilerMiddleware();
    expect(typeof middleware).toBe('function');
  });

  it('should call next with params', async () => {
    const middleware = createQueryProfilerMiddleware();
    const next = vi.fn().mockResolvedValue('result');
    const params = { action: 'findMany', model: 'User' };

    await middleware(params, next);

    expect(next).toHaveBeenCalledWith(params);
  });

  it('should return result from next', async () => {
    const middleware = createQueryProfilerMiddleware();
    const next = vi.fn().mockResolvedValue({ id: 1, name: 'Test' });
    const params = { action: 'findUnique', model: 'User' };

    const result = await middleware(params, next);

    expect(result).toEqual({ id: 1, name: 'Test' });
  });

  it('should create profile for query', async () => {
    const middleware = createQueryProfilerMiddleware();
    const next = vi.fn().mockResolvedValue([]);
    const params = { action: 'findMany', model: 'Post' };

    await middleware(params, next);

    const profiles = getQueryProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].query).toContain('findMany');
    expect(profiles[0].query).toContain('Post');
  });

  it('should track rows affected for arrays', async () => {
    const middleware = createQueryProfilerMiddleware();
    const next = vi.fn().mockResolvedValue([1, 2, 3, 4, 5]);
    const params = { action: 'findMany', model: 'User' };

    await middleware(params, next);

    const profiles = getQueryProfiles();
    expect(profiles[0].rowsAffected).toBe(5);
  });

  it('should track rows affected for numbers', async () => {
    const middleware = createQueryProfilerMiddleware();
    const next = vi.fn().mockResolvedValue(42);
    const params = { action: 'count', model: 'User' };

    await middleware(params, next);

    const profiles = getQueryProfiles();
    expect(profiles[0].rowsAffected).toBe(42);
  });

  it('should handle errors and rethrow', async () => {
    const middleware = createQueryProfilerMiddleware();
    const error = new Error('Query failed');
    const next = vi.fn().mockRejectedValue(error);
    const params = { action: 'findMany', model: 'User' };

    await expect(middleware(params, next)).rejects.toThrow('Query failed');

    // Should still record the query
    const profiles = getQueryProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].query).toContain('[ERROR]');
  });

  it('should handle missing model', async () => {
    const middleware = createQueryProfilerMiddleware();
    const next = vi.fn().mockResolvedValue([]);
    const params = { action: 'executeRaw' };

    await middleware(params, next);

    const profiles = getQueryProfiles();
    expect(profiles[0].query).toContain('unknown');
  });
});

describe('prismaQueryEventHandler()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryProfiles();
  });

  it('should create profile from query event', () => {
    prismaQueryEventHandler({
      query: 'SELECT * FROM users WHERE id = $1',
      duration: 25,
    });

    const profiles = getQueryProfiles();
    expect(profiles.length).toBe(1);
    expect(profiles[0].duration).toBe(25);
  });

  it('should detect operation type', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'INSERT INTO users VALUES', duration: 10 });
    prismaQueryEventHandler({ query: 'UPDATE users SET name = "test"', duration: 10 });
    prismaQueryEventHandler({ query: 'DELETE FROM users WHERE id = 1', duration: 10 });

    const profiles = getQueryProfiles();
    expect(profiles[0].operation).toBe('select');
    expect(profiles[1].operation).toBe('insert');
    expect(profiles[2].operation).toBe('update');
    expect(profiles[3].operation).toBe('delete');
  });

  it('should extract model name', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users WHERE id = 1', duration: 10 });
    prismaQueryEventHandler({ query: 'INSERT INTO posts VALUES (1, "test")', duration: 10 });

    const profiles = getQueryProfiles();
    expect(profiles[0].model).toBe('users');
    expect(profiles[1].model).toBe('posts');
  });

  it('should mark slow queries', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT * FROM slow_table', duration: 600 });

    const profiles = getQueryProfiles();
    expect(profiles[0].slow).toBe(false);
    expect(profiles[1].slow).toBe(true);
  });

  it('should emit debug event for slow queries', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM slow_table', duration: 600 });

    expect(debugEventEmitter.emitDebugEvent).toHaveBeenCalledWith('database', {
      type: 'slow_query',
      profile: expect.any(Object),
    });
  });

  it('should log warning for slow queries', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM slow_table', duration: 600 });

    expect(logger.warn).toHaveBeenCalledWith('Slow query detected', expect.any(Object));
  });

  it('should truncate long queries', () => {
    const longQuery = 'SELECT ' + 'a'.repeat(2000) + ' FROM users';
    prismaQueryEventHandler({ query: longQuery, duration: 10 });

    const profiles = getQueryProfiles();
    expect(profiles[0].query.length).toBeLessThanOrEqual(1000);
  });
});

describe('prismaErrorEventHandler()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log error message', () => {
    prismaErrorEventHandler({
      message: 'Connection failed',
      timestamp: new Date(),
    });

    expect(logger.error).toHaveBeenCalledWith('Prisma error', {
      message: 'Connection failed',
    });
  });

  it('should emit debug event', () => {
    const timestamp = new Date();
    prismaErrorEventHandler({
      message: 'Query timeout',
      timestamp,
    });

    expect(debugEventEmitter.emitDebugEvent).toHaveBeenCalledWith('database', {
      type: 'error',
      message: 'Query timeout',
      timestamp,
    });
  });
});

describe('Query profile structure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearQueryProfiles();
  });

  it('should have all required fields', () => {
    prismaQueryEventHandler({ query: 'SELECT * FROM users', duration: 10 });

    const profiles = getQueryProfiles();
    const profile = profiles[0];

    expect(profile).toHaveProperty('id');
    expect(profile).toHaveProperty('timestamp');
    expect(profile).toHaveProperty('query');
    expect(profile).toHaveProperty('duration');
    expect(profile).toHaveProperty('operation');
    expect(profile).toHaveProperty('slow');
  });

  it('should have unique IDs', () => {
    prismaQueryEventHandler({ query: 'SELECT 1', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT 2', duration: 10 });
    prismaQueryEventHandler({ query: 'SELECT 3', duration: 10 });

    const profiles = getQueryProfiles();
    const ids = profiles.map((p) => p.id);
    const uniqueIds = new Set(ids);

    expect(uniqueIds.size).toBe(ids.length);
  });

  it('should have valid ISO timestamps', () => {
    prismaQueryEventHandler({ query: 'SELECT 1', duration: 10 });

    const profiles = getQueryProfiles();
    const timestamp = profiles[0].timestamp;

    expect(() => new Date(timestamp)).not.toThrow();
  });
});

console.log('Query profiler test suite loaded');
