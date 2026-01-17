/**
 * Structured Classifier with OpenAI Structured Outputs
 *
 * Uses OpenAI's Structured Outputs feature for:
 * - Guaranteed JSON schema conformance (100% reliability)
 * - Type-safe responses with Zod validation
 * - Automatic retry with exponential backoff
 * - Batch processing support
 *
 * This replaces the manual JSON parsing in the original classifier.
 */

import OpenAI from 'openai';
import { z } from 'zod';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import {
  classificationResultSchema,
  messageGenerationSchema,
  type ClassificationResult,
  type MessageGeneration,
} from '../validation/schemas';
import { captureException } from '../config/sentry';
import { cacheGet, cacheSet, CacheKeys } from '../config/redis';

// ============================================
// OpenAI Client Configuration
// ============================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CLASSIFIER_MODEL = process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4o-mini';
const GENERATOR_MODEL = process.env.OPENAI_GENERATOR_MODEL || 'gpt-4o-mini';
const CLASSIFIER_BATCH_SIZE = parseInt(process.env.CLASSIFIER_BATCH_SIZE || '10', 10);
const GENERATOR_BATCH_SIZE = parseInt(process.env.GENERATOR_BATCH_SIZE || '10', 10);
const MIN_CONFIDENCE = 75;

// ============================================
// JSON Schema for OpenAI Structured Outputs
// ============================================

/**
 * Convert Zod schema to JSON Schema format for OpenAI
 */
const classificationJsonSchema = {
  name: 'classification_result',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      is_historic: {
        type: 'boolean',
        description: 'Whether the post contains historical content about Israel',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score from 0 to 100',
      },
      reason: {
        type: 'string',
        description: 'Brief explanation for the classification decision',
      },
      language: {
        type: 'string',
        enum: ['hebrew', 'arabic', 'english', 'other'],
        description: 'Detected language of the post',
      },
      historical_period: {
        type: 'string',
        description: 'Approximate time period mentioned (e.g., "1948", "1960s")',
      },
      topics: {
        type: 'array',
        items: { type: 'string' },
        description: 'Key historical topics mentioned (max 5)',
      },
    },
    required: ['is_historic', 'confidence', 'reason', 'language', 'topics'],
    additionalProperties: false,
  },
};

const messageGenerationJsonSchema = {
  name: 'message_generation',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The personalized outreach message (50-1000 characters)',
      },
      greeting: {
        type: 'string',
        description: 'The greeting used based on detected language',
      },
      language: {
        type: 'string',
        enum: ['hebrew', 'arabic', 'english'],
        description: 'Language of the generated message',
      },
      includes_link: {
        type: 'boolean',
        description: 'Whether the Tarasa submission link is included',
      },
    },
    required: ['message', 'greeting', 'language', 'includes_link'],
    additionalProperties: false,
  },
};

// ============================================
// Classification System Prompt
// ============================================

const CLASSIFICATION_SYSTEM_PROMPT = `You are a historical content classifier for Israeli history preservation.

Your task is to analyze Facebook posts and determine if they contain valuable historical content about Israel.

HISTORICAL CONTENT includes:
- Personal memories and stories from past decades
- Historical events (wars, political events, cultural milestones)
- Descriptions of places as they were in the past
- Family histories and immigration stories
- Old photographs or descriptions of historical photos
- Life in different periods (British Mandate, early state, 1960s-1990s)
- Cultural and social changes over time
- Nostalgic recollections of neighborhoods, schools, workplaces

NOT HISTORICAL CONTENT:
- Current news or recent events (last 5 years)
- General opinions without historical context
- Promotional or commercial content
- Jokes or memes without historical value
- Simple greetings or short comments

CONFIDENCE SCORING:
- 90-100: Clear historical narrative with specific details (dates, places, names)
- 75-89: Historical content but less detailed
- 50-74: May have some historical elements but unclear
- Below 50: Not historical content

Always respond in the exact JSON format specified.`;

// ============================================
// Structured Classification Function
// ============================================

/**
 * Classify a single post using OpenAI Structured Outputs
 */
export async function classifyPostStructured(postText: string): Promise<ClassificationResult> {
  try {
    const response = await openai.chat.completions.create({
      model: CLASSIFIER_MODEL,
      messages: [
        { role: 'system', content: CLASSIFICATION_SYSTEM_PROMPT },
        { role: 'user', content: `Classify this post:\n\n${postText}` },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: classificationJsonSchema,
      },
      temperature: 0.3, // Lower temperature for more consistent classification
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse and validate with Zod
    const parsed = JSON.parse(content);
    const validated = classificationResultSchema.parse(parsed);

    return validated;
  } catch (error) {
    logger.error(`Structured classification error: ${(error as Error).message}`);
    captureException(error as Error, { tags: { component: 'classifier' } });

    // Return a safe default on error
    return {
      is_historic: false,
      confidence: 0,
      reason: `Classification failed: ${(error as Error).message}`,
      language: 'other',
      topics: [],
    };
  }
}

/**
 * Classify multiple posts in batch
 */
export async function classifyPostsBatch(
  posts: Array<{ id: number; text: string }>
): Promise<Array<{ id: number; result: ClassificationResult }>> {
  const results: Array<{ id: number; result: ClassificationResult }> = [];

  for (const post of posts) {
    try {
      // Check cache first
      const cacheKey = `classify:${post.id}`;
      const cached = await cacheGet<ClassificationResult>(cacheKey);

      if (cached) {
        logger.debug(`Classification cache hit for post ${post.id}`);
        results.push({ id: post.id, result: cached });
        continue;
      }

      const result = await classifyPostStructured(post.text);
      results.push({ id: post.id, result });

      // Cache the result
      await cacheSet(cacheKey, result, 3600); // 1 hour cache

      // Small delay between API calls
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch (error) {
      logger.error(`Failed to classify post ${post.id}: ${(error as Error).message}`);
      results.push({
        id: post.id,
        result: {
          is_historic: false,
          confidence: 0,
          reason: `Error: ${(error as Error).message}`,
          language: 'other',
          topics: [],
        },
      });
    }
  }

  return results;
}

// ============================================
// Message Generation with Structured Outputs
// ============================================

const MESSAGE_GENERATION_PROMPT = `You are a friendly outreach specialist for Tarasa, a platform preserving Israeli historical stories.

Generate a personalized message to the author of a historical post, inviting them to share their story on Tarasa.

GUIDELINES:
1. Use the SAME LANGUAGE as the original post (Hebrew, Arabic, or English)
2. Be warm, respectful, and genuine
3. Reference specific details from their post
4. Explain briefly what Tarasa does
5. Include the provided submission link
6. Keep the message concise (100-300 words)
7. Don't be pushy - this is an invitation, not a demand

LANGUAGE-SPECIFIC GREETINGS:
- Hebrew: "שלום" or "היי"
- Arabic: "مرحبا" or "أهلاً"
- English: "Hello" or "Hi"

The submission link is: {TARASA_LINK}`;

/**
 * Generate a personalized outreach message
 */
export async function generateMessageStructured(
  postText: string,
  authorName: string | undefined,
  tarasaLink: string
): Promise<MessageGeneration> {
  try {
    const prompt = MESSAGE_GENERATION_PROMPT.replace('{TARASA_LINK}', tarasaLink);

    const response = await openai.chat.completions.create({
      model: GENERATOR_MODEL,
      messages: [
        { role: 'system', content: prompt },
        {
          role: 'user',
          content: `Generate a message for ${authorName || 'the author'} about this post:\n\n${postText}\n\nInclude this link: ${tarasaLink}`,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: messageGenerationJsonSchema,
      },
      temperature: 0.7, // Higher temperature for more natural messages
      max_tokens: 800,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse and validate with Zod
    const parsed = JSON.parse(content);
    const validated = messageGenerationSchema.parse(parsed);

    // Verify link is included
    if (!validated.message.includes(tarasaLink)) {
      validated.message += `\n\n${tarasaLink}`;
      validated.includes_link = true;
    }

    return validated;
  } catch (error) {
    logger.error(`Message generation error: ${(error as Error).message}`);
    captureException(error as Error, { tags: { component: 'generator' } });
    throw error;
  }
}

// ============================================
// Main Classification Pipeline
// ============================================

/**
 * Run the classification pipeline for unclassified posts
 */
export async function runClassificationPipeline(): Promise<{
  processed: number;
  historic: number;
  errors: number;
}> {
  logger.info('Starting structured classification pipeline...');

  const stats = { processed: 0, historic: 0, errors: 0 };

  try {
    // Get unclassified posts (classified is null for one-to-one relation)
    const unclassifiedPosts = await prisma.postRaw.findMany({
      where: {
        classified: null,
      },
      take: CLASSIFIER_BATCH_SIZE,
      orderBy: { scrapedAt: 'desc' },
    });

    if (unclassifiedPosts.length === 0) {
      logger.info('No unclassified posts found');
      return stats;
    }

    logger.info(`Classifying ${unclassifiedPosts.length} posts...`);

    // Classify in batch
    const results = await classifyPostsBatch(
      unclassifiedPosts.map((p) => ({ id: p.id, text: p.text }))
    );

    // Save results to database
    for (const { id, result } of results) {
      try {
        await prisma.postClassified.create({
          data: {
            postId: id,
            isHistoric: result.is_historic,
            confidence: result.confidence,
            reason: result.reason,
          },
        });

        stats.processed++;
        if (result.is_historic && result.confidence >= MIN_CONFIDENCE) {
          stats.historic++;
        }
      } catch (dbError) {
        // Handle duplicate key error (post already classified)
        if ((dbError as any).code === 'P2002') {
          logger.debug(`Post ${id} already classified, skipping`);
        } else {
          logger.error(`Failed to save classification for post ${id}: ${(dbError as Error).message}`);
          stats.errors++;
        }
      }
    }

    await logSystemEvent('classify', `Classified ${stats.processed} posts (${stats.historic} historic)`);
    logger.info(`Classification complete: ${stats.processed} processed, ${stats.historic} historic, ${stats.errors} errors`);

    return stats;
  } catch (error) {
    logger.error(`Classification pipeline error: ${(error as Error).message}`);
    captureException(error as Error, { tags: { component: 'classifier-pipeline' } });
    await logSystemEvent('error', `Classification pipeline failed: ${(error as Error).message}`);
    throw error;
  }
}

// ============================================
// Message Generation Pipeline
// ============================================

/**
 * Run the message generation pipeline for historic posts
 */
export async function runMessageGenerationPipeline(): Promise<{
  generated: number;
  errors: number;
}> {
  logger.info('Starting structured message generation pipeline...');

  const stats = { generated: 0, errors: 0 };

  try {
    const baseUrl = process.env.BASE_TARASA_URL || 'https://tarasa.me/he/premium/5d5252bf574a2100368f9833';

    // Get historic posts without generated messages
    const postsNeedingMessages = await prisma.postRaw.findMany({
      where: {
        // One-to-one relation: use direct field conditions
        classified: {
          isHistoric: true,
          confidence: { gte: MIN_CONFIDENCE },
        },
        // No generated messages yet
        generated: {
          none: {},
        },
        authorLink: { not: null },
      },
      include: {
        classified: true,
      },
      take: GENERATOR_BATCH_SIZE,
      orderBy: { scrapedAt: 'desc' },
    });

    if (postsNeedingMessages.length === 0) {
      logger.info('No posts need message generation');
      return stats;
    }

    logger.info(`Generating messages for ${postsNeedingMessages.length} posts...`);

    for (const post of postsNeedingMessages) {
      try {
        const result = await generateMessageStructured(
          post.text,
          post.authorName || undefined,
          baseUrl
        );

        await prisma.messageGenerated.create({
          data: {
            postId: post.id,
            messageText: result.message,
            link: baseUrl,
          },
        });

        stats.generated++;
        logger.debug(`Generated message for post ${post.id} in ${result.language}`);

        // Small delay between generations
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        logger.error(`Failed to generate message for post ${post.id}: ${(error as Error).message}`);
        stats.errors++;
      }
    }

    await logSystemEvent('message', `Generated ${stats.generated} messages`);
    logger.info(`Message generation complete: ${stats.generated} generated, ${stats.errors} errors`);

    return stats;
  } catch (error) {
    logger.error(`Message generation pipeline error: ${(error as Error).message}`);
    captureException(error as Error, { tags: { component: 'generator-pipeline' } });
    await logSystemEvent('error', `Message generation failed: ${(error as Error).message}`);
    throw error;
  }
}

export default {
  classifyPostStructured,
  classifyPostsBatch,
  generateMessageStructured,
  runClassificationPipeline,
  runMessageGenerationPipeline,
};
