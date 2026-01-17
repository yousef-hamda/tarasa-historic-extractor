/**
 * Validation Schema Tests
 *
 * Tests for Zod validation schemas
 */

import { describe, it, expect } from 'vitest';
import {
  envSchema,
  paginationSchema,
  postFilterSchema,
  classificationResultSchema,
  messageGenerationSchema,
  validateWithErrors,
} from '../src/validation/schemas';

describe('Validation Schemas', () => {
  describe('paginationSchema', () => {
    it('should accept valid pagination params', () => {
      const result = paginationSchema.safeParse({ limit: 50, offset: 10 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
        expect(result.data.offset).toBe(10);
      }
    });

    it('should use defaults when params are missing', () => {
      const result = paginationSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(100);
        expect(result.data.offset).toBe(0);
      }
    });

    it('should coerce string values to numbers', () => {
      const result = paginationSchema.safeParse({ limit: '25', offset: '5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(25);
        expect(result.data.offset).toBe(5);
      }
    });

    it('should reject limit above maximum', () => {
      const result = paginationSchema.safeParse({ limit: 1000 });
      expect(result.success).toBe(false);
    });

    it('should reject negative offset', () => {
      const result = paginationSchema.safeParse({ offset: -5 });
      expect(result.success).toBe(false);
    });
  });

  describe('postFilterSchema', () => {
    it('should accept valid post filters', () => {
      const result = postFilterSchema.safeParse({
        limit: 20,
        offset: 0,
        groupId: '123456789',
        isHistoric: true,
        minConfidence: 75,
      });
      expect(result.success).toBe(true);
    });

    it('should coerce boolean strings', () => {
      const result = postFilterSchema.safeParse({ isHistoric: 'true' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isHistoric).toBe(true);
      }
    });
  });

  describe('classificationResultSchema', () => {
    it('should accept valid classification result', () => {
      const result = classificationResultSchema.safeParse({
        is_historic: true,
        confidence: 85,
        reason: 'Contains historical memories from 1960s Tel Aviv',
        language: 'hebrew',
        topics: ['nostalgia', 'Tel Aviv', '1960s'],
      });
      expect(result.success).toBe(true);
    });

    it('should reject confidence outside range', () => {
      const result = classificationResultSchema.safeParse({
        is_historic: true,
        confidence: 150,
        reason: 'Test',
        language: 'hebrew',
        topics: [],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid language', () => {
      const result = classificationResultSchema.safeParse({
        is_historic: true,
        confidence: 50,
        reason: 'Test',
        language: 'french',
        topics: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('messageGenerationSchema', () => {
    it('should accept valid message generation', () => {
      const result = messageGenerationSchema.safeParse({
        message: 'שלום! קראתי את הסיפור המרתק שלך על ירושלים של פעם. נשמח אם תשתף את הזיכרונות בטרסה.',
        greeting: 'שלום',
        language: 'hebrew',
        includes_link: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject message that is too short', () => {
      const result = messageGenerationSchema.safeParse({
        message: 'Hi',
        greeting: 'Hi',
        language: 'english',
        includes_link: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('validateWithErrors', () => {
    it('should return success with valid data', () => {
      const result = validateWithErrors(paginationSchema, { limit: 50 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
      }
    });

    it('should return error messages for invalid data', () => {
      const result = validateWithErrors(paginationSchema, { limit: -5 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('envSchema', () => {
    it('should validate required environment variables', () => {
      const validEnv = {
        FB_EMAIL: 'test@example.com',
        FB_PASSWORD: 'password123',
        OPENAI_API_KEY: 'sk-test123',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        GROUP_IDS: '123,456,789',
      };

      const result = envSchema.safeParse(validEnv);
      expect(result.success).toBe(true);
    });

    it('should reject invalid OpenAI API key format', () => {
      const invalidEnv = {
        FB_EMAIL: 'test@example.com',
        FB_PASSWORD: 'password123',
        OPENAI_API_KEY: 'invalid-key',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        GROUP_IDS: '123',
      };

      const result = envSchema.safeParse(invalidEnv);
      expect(result.success).toBe(false);
    });

    it('should apply default values', () => {
      const minimalEnv = {
        FB_EMAIL: 'test@example.com',
        FB_PASSWORD: 'password123',
        OPENAI_API_KEY: 'sk-test123',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        GROUP_IDS: '123',
      };

      const result = envSchema.safeParse(minimalEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PORT).toBe(4000);
        expect(result.data.NODE_ENV).toBe('development');
        expect(result.data.MAX_MESSAGES_PER_DAY).toBe(20);
      }
    });
  });
});
