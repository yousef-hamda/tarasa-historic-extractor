/**
 * Zod Validation Schemas
 *
 * Centralized schema definitions for API input validation,
 * OpenAI structured outputs, and environment validation.
 *
 * Benefits:
 * - Runtime type safety
 * - Automatic TypeScript type inference
 * - Clear error messages
 * - Works with OpenAI Structured Outputs
 */

import { z } from 'zod';

// ============================================
// Environment Validation
// ============================================

export const envSchema = z.object({
  // Required
  FB_EMAIL: z.string().email('Invalid Facebook email'),
  FB_PASSWORD: z.string().min(1, 'Facebook password is required'),
  OPENAI_API_KEY: z.string().startsWith('sk-', 'Invalid OpenAI API key format'),
  DATABASE_URL: z.string().url('Invalid database URL'),
  GROUP_IDS: z.string().min(1, 'At least one group ID required'),

  // Optional with defaults
  PORT: z.string().default('4000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MAX_MESSAGES_PER_DAY: z.string().default('20').transform(Number),
  CLASSIFIER_BATCH_SIZE: z.string().default('10').transform(Number),
  GENERATOR_BATCH_SIZE: z.string().default('10').transform(Number),
  APIFY_RESULTS_LIMIT: z.string().default('20').transform(Number),
  HEADLESS: z.string().default('true').transform((v) => v === 'true'),

  // Optional
  API_KEY: z.string().optional(),
  APIFY_TOKEN: z.string().optional(),
  SYSTEM_EMAIL_ALERT: z.string().email().optional().or(z.literal('')),
  SYSTEM_EMAIL_PASSWORD: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  BASE_TARASA_URL: z.string().url().optional(),
  OPENAI_CLASSIFIER_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_GENERATOR_MODEL: z.string().default('gpt-4o-mini'),
});

export type EnvConfig = z.infer<typeof envSchema>;

// ============================================
// API Request Schemas
// ============================================

// Pagination
export const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(500).default(100),
  offset: z.coerce.number().min(0).default(0),
});

// Post filters
export const postFilterSchema = paginationSchema.extend({
  groupId: z.string().optional(),
  isHistoric: z.coerce.boolean().optional(),
  minConfidence: z.coerce.number().min(0).max(100).optional(),
  authorName: z.string().optional(),
});

// Log filters
export const logFilterSchema = paginationSchema.extend({
  type: z.enum(['scrape', 'classify', 'message', 'auth', 'error']).optional(),
});

// Message filters
export const messageFilterSchema = paginationSchema.extend({
  status: z.enum(['pending', 'sent', 'error']).optional(),
});

// Trigger requests
export const triggerScrapeSchema = z.object({
  groupId: z.string().optional(),
  force: z.boolean().default(false),
});

export const triggerClassifySchema = z.object({
  batchSize: z.number().min(1).max(100).optional(),
});

export const triggerMessageSchema = z.object({
  limit: z.number().min(1).max(50).optional(),
});

// Settings
export const settingsUpdateSchema = z.object({
  messagingEnabled: z.boolean().optional(),
  maxMessagesPerDay: z.number().min(0).max(100).optional(),
  classifierBatchSize: z.number().min(1).max(50).optional(),
  generatorBatchSize: z.number().min(1).max(50).optional(),
});

// Group management
export const groupUpdateSchema = z.object({
  groupId: z.string(),
  isAccessible: z.boolean().optional(),
  groupType: z.enum(['public', 'private', 'unknown']).optional(),
  accessMethod: z.enum(['apify', 'playwright', 'mbasic', 'none']).optional(),
});

// ============================================
// OpenAI Structured Output Schemas
// ============================================

// Classification result - used with OpenAI Structured Outputs
export const classificationResultSchema = z.object({
  is_historic: z.boolean().describe('Whether the post contains historical content'),
  confidence: z.number().min(0).max(100).describe('Confidence score 0-100'),
  reason: z.string().max(500).describe('Brief explanation for the classification'),
  language: z.enum(['hebrew', 'arabic', 'english', 'other']).describe('Detected language of the post'),
  historical_period: z.string().optional().describe('Approximate time period mentioned (e.g., "1948", "1960s", "Ottoman era")'),
  topics: z.array(z.string()).max(5).describe('Key historical topics mentioned'),
});

export type ClassificationResult = z.infer<typeof classificationResultSchema>;

// Message generation result
export const messageGenerationSchema = z.object({
  message: z.string().min(50).max(1000).describe('The personalized outreach message'),
  greeting: z.string().describe('The greeting used (e.g., "שלום", "مرحبا", "Hello")'),
  language: z.enum(['hebrew', 'arabic', 'english']).describe('Language of the generated message'),
  includes_link: z.boolean().describe('Whether the Tarasa link is included'),
});

export type MessageGeneration = z.infer<typeof messageGenerationSchema>;

// Batch classification for multiple posts
export const batchClassificationSchema = z.object({
  results: z.array(z.object({
    post_id: z.string().describe('The post identifier'),
    classification: classificationResultSchema,
  })),
});

export type BatchClassification = z.infer<typeof batchClassificationSchema>;

// ============================================
// Scraped Data Schemas
// ============================================

export const scrapedPostSchema = z.object({
  fbPostId: z.string(),
  authorName: z.string().optional(),
  authorLink: z.string().url().optional(),
  authorPhoto: z.string().url().optional(),
  text: z.string().min(30),
});

export type ScrapedPost = z.infer<typeof scrapedPostSchema>;

// ============================================
// Validation Utilities
// ============================================

/**
 * Validate and parse data with detailed error messages
 */
export function validateWithErrors<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: string[] } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map((issue) => {
    const path = issue.path.join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });

  return { success: false, errors };
}

/**
 * Express middleware factory for request validation
 */
export function validateRequest<T>(schema: z.ZodSchema<T>, source: 'body' | 'query' | 'params' = 'body') {
  return (req: any, res: any, next: any) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const errors = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));

      return res.status(400).json({
        error: 'Validation Error',
        details: errors,
      });
    }

    // Replace with validated and coerced data
    req[source] = result.data;
    next();
  };
}

/**
 * Convert Zod schema to JSON Schema for OpenAI
 */
export function zodToJsonSchema(schema: z.ZodSchema): object {
  // This is a simplified converter - for production use zod-to-json-schema package
  const zodToJson = (s: z.ZodTypeAny): any => {
    const typeName = s._def.typeName;

    switch (typeName) {
      case 'ZodString':
        return { type: 'string' };
      case 'ZodNumber':
        return { type: 'number' };
      case 'ZodBoolean':
        return { type: 'boolean' };
      case 'ZodArray':
        return { type: 'array', items: zodToJson(s._def.type) };
      case 'ZodEnum':
        return { type: 'string', enum: s._def.values };
      case 'ZodObject': {
        const shape = s._def.shape();
        const properties: Record<string, any> = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(shape)) {
          properties[key] = zodToJson(value as z.ZodTypeAny);
          if (!(value as any).isOptional()) {
            required.push(key);
          }
        }

        return {
          type: 'object',
          properties,
          required,
          additionalProperties: false,
        };
      }
      case 'ZodOptional':
        return zodToJson(s._def.innerType);
      default:
        return { type: 'string' };
    }
  };

  return zodToJson(schema);
}
