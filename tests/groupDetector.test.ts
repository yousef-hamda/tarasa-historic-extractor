/**
 * Comprehensive tests for group detector utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock prisma
vi.mock('../src/database/prisma', () => ({
  default: {
    groupInfo: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock session manager
vi.mock('../src/session/sessionManager', () => ({
  isSessionValid: vi.fn(),
}));

import {
  getCachedGroupInfo,
  updateGroupCache,
  detectGroupType,
  getRecommendedAccessMethod,
  getGroupsWithAccessInfo,
  markGroupScraped,
  markGroupError,
} from '../src/scraper/groupDetector';
import prisma from '../src/database/prisma';
import { isSessionValid } from '../src/session/sessionManager';
import logger from '../src/utils/logger';

describe('getCachedGroupInfo()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return cached group info when exists', async () => {
    const cachedData = {
      groupId: '123456',
      groupType: 'public',
      groupName: 'Test Group',
      memberCount: 1000,
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
      lastChecked: new Date(),
      lastScraped: new Date(),
    };
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(cachedData as any);

    const result = await getCachedGroupInfo('123456');

    expect(result).toEqual(cachedData);
    expect(prisma.groupInfo.findUnique).toHaveBeenCalledWith({
      where: { groupId: '123456' },
    });
  });

  it('should return null when no cache exists', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);

    const result = await getCachedGroupInfo('999999');

    expect(result).toBeNull();
  });

  it('should return null and log error on database failure', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockRejectedValue(new Error('Database error'));

    const result = await getCachedGroupInfo('123456');

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to get cached group info')
    );
  });

  it('should handle empty groupId', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);

    const result = await getCachedGroupInfo('');

    expect(result).toBeNull();
    expect(prisma.groupInfo.findUnique).toHaveBeenCalledWith({
      where: { groupId: '' },
    });
  });
});

describe('updateGroupCache()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.groupInfo.upsert).mockResolvedValue({} as any);
  });

  it('should upsert group info with all fields', async () => {
    const data = {
      groupType: 'public' as const,
      groupName: 'Test Group',
      memberCount: 500,
      accessMethod: 'playwright' as const,
      isAccessible: true,
      errorMessage: null,
      lastScraped: new Date('2024-01-01'),
    };

    await updateGroupCache('123456', data);

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith({
      where: { groupId: '123456' },
      update: {
        ...data,
        lastChecked: expect.any(Date),
      },
      create: {
        groupId: '123456',
        groupType: 'public',
        groupName: 'Test Group',
        memberCount: 500,
        accessMethod: 'playwright',
        isAccessible: true,
        errorMessage: null,
        lastScraped: expect.any(Date),
      },
    });
  });

  it('should use defaults for missing fields in create', async () => {
    await updateGroupCache('123456', {});

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith({
      where: { groupId: '123456' },
      update: {
        lastChecked: expect.any(Date),
      },
      create: {
        groupId: '123456',
        groupType: 'unknown',
        groupName: undefined,
        memberCount: undefined,
        accessMethod: 'none',
        isAccessible: true,
        errorMessage: undefined,
        lastScraped: undefined,
      },
    });
  });

  it('should handle partial update', async () => {
    await updateGroupCache('123456', { isAccessible: false });

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          isAccessible: false,
          lastChecked: expect.any(Date),
        },
      })
    );
  });

  it('should log error on database failure', async () => {
    vi.mocked(prisma.groupInfo.upsert).mockRejectedValue(new Error('Write failed'));

    await updateGroupCache('123456', { groupType: 'public' as const });

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to update group cache')
    );
  });

  it('should not throw on database failure', async () => {
    vi.mocked(prisma.groupInfo.upsert).mockRejectedValue(new Error('Write failed'));

    await expect(
      updateGroupCache('123456', { groupType: 'public' as const })
    ).resolves.not.toThrow();
  });
});

describe('detectGroupType()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.mocked(prisma.groupInfo.upsert).mockResolvedValue({} as any);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return cached result if fresh', async () => {
    const recentCache = {
      groupId: '123456',
      groupType: 'public',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
      lastChecked: new Date(), // Just checked
    };
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(recentCache as any);

    const result = await detectGroupType('123456');

    expect(result).toEqual({
      groupId: '123456',
      groupType: 'public',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Using cached group type')
    );
  });

  it('should skip stale cache (older than 24 hours)', async () => {
    const staleCache = {
      groupId: '123456',
      groupType: 'public',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
      lastChecked: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
    };
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(staleCache as any);
    vi.mocked(isSessionValid).mockResolvedValue(true);

    await detectGroupType('123456');

    // Should have updated the cache (because stale)
    expect(prisma.groupInfo.upsert).toHaveBeenCalled();
  });

  it('should return playwright method when session is valid', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);
    vi.mocked(isSessionValid).mockResolvedValue(true);

    const result = await detectGroupType('123456');

    expect(result).toEqual({
      groupId: '123456',
      groupType: 'unknown',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
    });
  });

  it('should return error when no session available', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);
    vi.mocked(isSessionValid).mockResolvedValue(false);

    const result = await detectGroupType('123456');

    expect(result.isAccessible).toBe(false);
    expect(result.accessMethod).toBe('none');
    expect(result.errorMessage).toContain('No valid Facebook session');
  });

  it('should skip unknown cache type even if fresh', async () => {
    const unknownCache = {
      groupId: '123456',
      groupType: 'unknown',
      accessMethod: 'none',
      isAccessible: true,
      errorMessage: null,
      lastChecked: new Date(),
    };
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(unknownCache as any);
    vi.mocked(isSessionValid).mockResolvedValue(true);

    await detectGroupType('123456');

    // Should re-detect since type is unknown
    expect(prisma.groupInfo.upsert).toHaveBeenCalled();
  });
});

describe('getRecommendedAccessMethod()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.groupInfo.upsert).mockResolvedValue({} as any);
  });

  it('should return playwright for public groups', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue({
      groupId: '123456',
      groupType: 'public',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
      lastChecked: new Date(),
    } as any);
    vi.mocked(isSessionValid).mockResolvedValue(true);

    const result = await getRecommendedAccessMethod('123456');

    expect(result.method).toBe('playwright');
    expect(result.reason).toContain('Public group');
  });

  it('should return playwright for private groups with access', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue({
      groupId: '123456',
      groupType: 'private',
      accessMethod: 'playwright',
      isAccessible: true,
      errorMessage: null,
      lastChecked: new Date(),
    } as any);
    vi.mocked(isSessionValid).mockResolvedValue(true);

    const result = await getRecommendedAccessMethod('123456');

    expect(result.method).toBe('playwright');
    expect(result.isAccessible).toBe(true);
    expect(result.reason).toContain('Private group');
  });

  it('should return none for private groups without access', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue({
      groupId: '123456',
      groupType: 'private',
      accessMethod: 'none',
      isAccessible: false,
      errorMessage: 'Not a member',
      lastChecked: new Date(),
    } as any);
    vi.mocked(isSessionValid).mockResolvedValue(true);

    const result = await getRecommendedAccessMethod('123456');

    expect(result.method).toBe('none');
    expect(result.isAccessible).toBe(false);
    expect(result.reason).toContain('Not a member');
  });

  it('should return playwright for unknown groups', async () => {
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);
    vi.mocked(isSessionValid).mockResolvedValue(true);

    const result = await getRecommendedAccessMethod('123456');

    expect(result.method).toBe('playwright');
    expect(result.reason).toContain('Unknown group type');
  });
});

describe('getGroupsWithAccessInfo()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return empty array when no groups configured', async () => {
    process.env.GROUP_IDS = '';

    const result = await getGroupsWithAccessInfo();

    expect(result).toEqual([]);
  });

  it('should return cached info for existing groups', async () => {
    process.env.GROUP_IDS = '123456,789012';
    vi.mocked(prisma.groupInfo.findUnique)
      .mockResolvedValueOnce({
        groupId: '123456',
        groupType: 'public',
        accessMethod: 'playwright',
        isAccessible: true,
        lastScraped: new Date('2024-01-01'),
      } as any)
      .mockResolvedValueOnce({
        groupId: '789012',
        groupType: 'private',
        accessMethod: 'playwright',
        isAccessible: true,
        lastScraped: new Date('2024-01-02'),
      } as any);

    const result = await getGroupsWithAccessInfo();

    expect(result).toHaveLength(2);
    expect(result[0].groupType).toBe('public');
    expect(result[1].groupType).toBe('private');
  });

  it('should return defaults for new groups', async () => {
    process.env.GROUP_IDS = '123456';
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);

    const result = await getGroupsWithAccessInfo();

    expect(result).toEqual([
      {
        groupId: '123456',
        groupType: 'unknown',
        accessMethod: 'none',
        isAccessible: true,
        lastScraped: null,
      },
    ]);
  });

  it('should handle whitespace in GROUP_IDS', async () => {
    process.env.GROUP_IDS = '  123456  ,  789012  ';
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);

    const result = await getGroupsWithAccessInfo();

    expect(result).toHaveLength(2);
    expect(result[0].groupId).toBe('123456');
    expect(result[1].groupId).toBe('789012');
  });

  it('should filter empty group IDs', async () => {
    process.env.GROUP_IDS = '123456,,789012,';
    vi.mocked(prisma.groupInfo.findUnique).mockResolvedValue(null);

    const result = await getGroupsWithAccessInfo();

    expect(result).toHaveLength(2);
  });
});

describe('markGroupScraped()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.groupInfo.upsert).mockResolvedValue({} as any);
  });

  it('should update group with scrape info', async () => {
    await markGroupScraped('123456', 'playwright');

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId: '123456' },
        update: {
          accessMethod: 'playwright',
          lastScraped: expect.any(Date),
          isAccessible: true,
          errorMessage: null,
          lastChecked: expect.any(Date),
        },
      })
    );
  });

  it('should clear error message on success', async () => {
    await markGroupScraped('123456', 'playwright');

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          errorMessage: null,
        }),
      })
    );
  });

  it('should log debug message', async () => {
    await markGroupScraped('123456', 'playwright');

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('marked as successfully scraped')
    );
  });
});

describe('markGroupError()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.groupInfo.upsert).mockResolvedValue({} as any);
  });

  it('should update group with error info', async () => {
    await markGroupError('123456', 'Failed to load page');

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { groupId: '123456' },
        update: {
          isAccessible: false,
          errorMessage: 'Failed to load page',
          lastChecked: expect.any(Date),
        },
      })
    );
  });

  it('should mark group as inaccessible', async () => {
    await markGroupError('123456', 'Error');

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          isAccessible: false,
        }),
      })
    );
  });

  it('should handle empty error message', async () => {
    await markGroupError('123456', '');

    expect(prisma.groupInfo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          errorMessage: '',
        }),
      })
    );
  });
});

console.log('Group detector test suite loaded');
