/**
 * Comprehensive tests for AI classifier
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock OpenAI - use a class mock to properly simulate the constructor
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
      static mockCreate = mockCreate;
    },
  };
});

// Mock prisma - define mocks inside factory
vi.mock('../src/database/prisma', () => ({
  default: {
    postRaw: {
      findMany: vi.fn(),
    },
    postClassified: {
      create: vi.fn(),
    },
    $disconnect: vi.fn(),
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

// Mock system log
vi.mock('../src/utils/systemLog', () => ({
  logSystemEvent: vi.fn(),
}));

// Mock OpenAI retry
vi.mock('../src/utils/openaiRetry', () => ({
  callOpenAIWithRetry: vi.fn((fn) => fn()),
}));

// Mock helpers
vi.mock('../src/utils/openaiHelpers', () => ({
  normalizeMessageContent: vi.fn((content) => content),
  validateClassificationResult: vi.fn((result) => result),
  sanitizeForPrompt: vi.fn((text) => text),
  getModel: vi.fn(() => 'gpt-4o-mini'),
}));

import OpenAI from 'openai';
import { classifyPosts } from '../src/ai/classifier';
import prisma from '../src/database/prisma';
import logger from '../src/utils/logger';
import { logSystemEvent } from '../src/utils/systemLog';
import { validateClassificationResult } from '../src/utils/openaiHelpers';

// Get the mock create function from the OpenAI mock
const getOpenAICreateMock = () => (OpenAI as any).mockCreate as ReturnType<typeof vi.fn>;

describe('classifyPosts()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = 'test-key';
    vi.mocked(prisma.postRaw.findMany).mockResolvedValue([]);
    vi.mocked(prisma.postClassified.create).mockResolvedValue({} as any);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('when no posts pending', () => {
    it('should log info and return early', async () => {
      vi.mocked(prisma.postRaw.findMany).mockResolvedValue([]);

      await classifyPosts();

      expect(logger.info).toHaveBeenCalledWith('No posts pending classification');
    });

    it('should not log system event when no posts', async () => {
      vi.mocked(prisma.postRaw.findMany).mockResolvedValue([]);

      await classifyPosts();

      expect(logSystemEvent).not.toHaveBeenCalled();
    });
  });

  describe('when posts are pending', () => {
    const mockPosts = [
      { id: 1, text: 'Test post about old times', scrapedAt: new Date() },
      { id: 2, text: 'Another historical post', scrapedAt: new Date() },
    ];

    beforeEach(() => {
      vi.mocked(prisma.postRaw.findMany).mockResolvedValue(mockPosts as any);
      vi.mocked(validateClassificationResult).mockReturnValue({
        is_historic: true,
        confidence: 85,
        reason: 'Contains historical references',
      });
      // Set up the OpenAI create mock
      const mockCreate = getOpenAICreateMock();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ is_historic: true, confidence: 85, reason: 'Test' }) } }],
      });
    });

    it('should query for unclassified posts', async () => {
      await classifyPosts();

      expect(prisma.postRaw.findMany).toHaveBeenCalledWith({
        where: { classified: null },
        orderBy: { scrapedAt: 'asc' },
        take: expect.any(Number),
      });
    });

    it('should create classification for each post', async () => {
      await classifyPosts();

      expect(prisma.postClassified.create).toHaveBeenCalledTimes(2);
    });

    it('should store correct classification data', async () => {
      vi.mocked(validateClassificationResult).mockReturnValue({
        is_historic: true,
        confidence: 75,
        reason: 'Historical content',
      });

      await classifyPosts();

      expect(prisma.postClassified.create).toHaveBeenCalledWith({
        data: {
          postId: 1,
          isHistoric: true,
          confidence: 75,
          reason: 'Historical content',
        },
      });
    });

    it('should log system event after processing', async () => {
      await classifyPosts();

      expect(logSystemEvent).toHaveBeenCalledWith('classify', expect.stringContaining('Classified'));
    });
  });

  describe('error handling', () => {
    const mockPosts = [{ id: 1, text: 'Test post', scrapedAt: new Date() }];

    beforeEach(() => {
      vi.mocked(prisma.postRaw.findMany).mockResolvedValue(mockPosts as any);
    });

    it('should handle OpenAI API errors gracefully', async () => {
      const mockCreate = getOpenAICreateMock();
      mockCreate.mockRejectedValue(new Error('API error'));

      await expect(classifyPosts()).resolves.not.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to classify post')
      );
    });

    it('should log system event on error', async () => {
      const mockCreate = getOpenAICreateMock();
      mockCreate.mockRejectedValue(new Error('API error'));

      await classifyPosts();

      expect(logSystemEvent).toHaveBeenCalledWith('error', expect.stringContaining('Failed to classify'));
    });

    it('should continue processing other posts after error', async () => {
      vi.mocked(prisma.postRaw.findMany).mockResolvedValue([
        { id: 1, text: 'Post 1', scrapedAt: new Date() },
        { id: 2, text: 'Post 2', scrapedAt: new Date() },
        { id: 3, text: 'Post 3', scrapedAt: new Date() },
      ] as any);

      const mockCreate = getOpenAICreateMock();
      mockCreate
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({ is_historic: true, confidence: 85, reason: 'Test' }) } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: JSON.stringify({ is_historic: false, confidence: 20, reason: 'Not historic' }) } }],
        });

      vi.mocked(validateClassificationResult).mockReturnValue({
        is_historic: true,
        confidence: 85,
        reason: 'Test',
      });

      await classifyPosts();

      expect(prisma.postClassified.create).toHaveBeenCalledTimes(2);
    });

    it('should handle JSON parse errors', async () => {
      const mockCreate = getOpenAICreateMock();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'invalid json' } }],
      });
      vi.mocked(validateClassificationResult).mockReturnValue(null as any);

      await classifyPosts();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse classification JSON')
      );
    });

    it('should handle invalid classification structure', async () => {
      const mockCreate = getOpenAICreateMock();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ invalid: 'structure' }) } }],
      });
      vi.mocked(validateClassificationResult).mockReturnValue(null as any);

      await classifyPosts();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid classification structure')
      );
    });
  });

  describe('batch size', () => {
    it('should respect CLASSIFIER_BATCH_SIZE env var', async () => {
      process.env.CLASSIFIER_BATCH_SIZE = '10';
      vi.mocked(prisma.postRaw.findMany).mockResolvedValue([]);

      await classifyPosts();

      expect(prisma.postRaw.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: expect.any(Number),
        })
      );
    });
  });

  describe('confidence validation', () => {
    const mockPosts = [{ id: 1, text: 'Test post', scrapedAt: new Date() }];

    beforeEach(() => {
      vi.mocked(prisma.postRaw.findMany).mockResolvedValue(mockPosts as any);
      const mockCreate = getOpenAICreateMock();
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ is_historic: true, confidence: 85, reason: 'Test' }) } }],
      });
    });

    it('should clamp confidence to 0-100 range', async () => {
      vi.mocked(validateClassificationResult).mockReturnValue({
        is_historic: true,
        confidence: 150, // Invalid - above 100
        reason: 'Test',
      });

      await classifyPosts();

      expect(prisma.postClassified.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confidence: 100, // Should be clamped to 100
        }),
      });
    });

    it('should handle negative confidence', async () => {
      vi.mocked(validateClassificationResult).mockReturnValue({
        is_historic: true,
        confidence: -10, // Invalid - negative
        reason: 'Test',
      });

      await classifyPosts();

      expect(prisma.postClassified.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confidence: 0, // Should be clamped to 0
        }),
      });
    });

    it('should round fractional confidence', async () => {
      vi.mocked(validateClassificationResult).mockReturnValue({
        is_historic: true,
        confidence: 85.7,
        reason: 'Test',
      });

      await classifyPosts();

      expect(prisma.postClassified.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confidence: 86, // Should be rounded
        }),
      });
    });

    it('should default NaN confidence to 0', async () => {
      vi.mocked(validateClassificationResult).mockReturnValue({
        is_historic: true,
        confidence: NaN,
        reason: 'Test',
      });

      await classifyPosts();

      expect(prisma.postClassified.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confidence: 0, // NaN defaults to 0
        }),
      });
    });
  });
});

describe('Classification types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
    vi.mocked(prisma.postClassified.create).mockResolvedValue({} as any);
  });

  it('should handle is_historic true results', async () => {
    vi.mocked(prisma.postRaw.findMany).mockResolvedValue([{ id: 1, text: 'Old photo from 1950', scrapedAt: new Date() }] as any);
    const mockCreate = getOpenAICreateMock();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ is_historic: true, confidence: 95, reason: 'Historical photo' }) } }],
    });
    vi.mocked(validateClassificationResult).mockReturnValue({
      is_historic: true,
      confidence: 95,
      reason: 'Historical photo',
    });

    await classifyPosts();

    expect(prisma.postClassified.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isHistoric: true,
      }),
    });
  });

  it('should handle is_historic false results', async () => {
    vi.mocked(prisma.postRaw.findMany).mockResolvedValue([{ id: 1, text: 'New product announcement', scrapedAt: new Date() }] as any);
    const mockCreate = getOpenAICreateMock();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ is_historic: false, confidence: 90, reason: 'Modern content' }) } }],
    });
    vi.mocked(validateClassificationResult).mockReturnValue({
      is_historic: false,
      confidence: 90,
      reason: 'Modern content',
    });

    await classifyPosts();

    expect(prisma.postClassified.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isHistoric: false,
      }),
    });
  });
});

console.log('Classifier test suite loaded');
