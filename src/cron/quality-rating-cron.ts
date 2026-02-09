/**
 * Quality Rating Cron Job
 *
 * Automatically rates the quality of historic posts using AI
 * Runs after classification to add quality scores (1-5 stars)
 */

import cron from 'node-cron';
import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { acquireLock, releaseLock } from '../utils/cronLock';
import { callOpenAIWithRetry } from '../utils/openaiRetry';
import { normalizeMessageContent, sanitizeForPrompt, getModel } from '../utils/openaiHelpers';

const LOCK_NAME = 'quality-rating';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = getModel('classifier'); // Use classifier model for consistency

const QUALITY_PROMPT = `You are an expert story quality evaluator for Tarasa, a platform preserving community history.

Rate the quality of this historical story/memory on these factors (1-5 scale each):
1. **Narrative Quality**: How well-structured and engaging is the storytelling?
2. **Emotional Impact**: Does the story evoke emotions or connection?
3. **Historical Value**: How significant is the historical information shared?
4. **Uniqueness**: How unique or rare is this story/perspective?

Also provide an overall rating (1-5) based on these factors.

Return JSON with this exact structure:
{
  "rating": <overall 1-5>,
  "factors": {
    "narrative": <1-5>,
    "emotional": <1-5>,
    "historical": <1-5>,
    "uniqueness": <1-5>
  }
}`;

const QUALITY_SCHEMA = {
  name: 'quality_rating_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      rating: { type: 'integer', minimum: 1, maximum: 5 },
      factors: {
        type: 'object',
        additionalProperties: false,
        properties: {
          narrative: { type: 'integer', minimum: 1, maximum: 5 },
          emotional: { type: 'integer', minimum: 1, maximum: 5 },
          historical: { type: 'integer', minimum: 1, maximum: 5 },
          uniqueness: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['narrative', 'emotional', 'historical', 'uniqueness'],
      },
    },
    required: ['rating', 'factors'],
  },
} as const;

const BATCH_SIZE = 10;

export const rateQuality = async (): Promise<void> => {
  const hasLock = await acquireLock(LOCK_NAME);
  if (!hasLock) {
    logger.debug('[Quality Rating] Another instance is running, skipping');
    return;
  }

  try {
    // Find historic posts that haven't been rated yet
    const unratedPosts = await prisma.postRaw.findMany({
      where: {
        classified: {
          isHistoric: true,
          confidence: { gte: 75 },
        },
        quality: null, // Not yet rated
      },
      include: { classified: true },
      orderBy: { scrapedAt: 'desc' },
      take: BATCH_SIZE,
    });

    if (unratedPosts.length === 0) {
      logger.debug('[Quality Rating] No posts pending rating');
      return;
    }

    logger.info(`[Quality Rating] Rating ${unratedPosts.length} posts`);

    let rated = 0;

    for (const post of unratedPosts) {
      try {
        const completion = await callOpenAIWithRetry(() =>
          openai.chat.completions.create({
            model,
            temperature: 0.3,
            response_format: { type: 'json_schema', json_schema: QUALITY_SCHEMA },
            messages: [
              { role: 'system', content: QUALITY_PROMPT },
              { role: 'user', content: sanitizeForPrompt(post.text) },
            ],
          })
        );

        const rawContent = completion.choices[0]?.message?.content;
        const textContent = normalizeMessageContent(rawContent);

        let result: { rating: number; factors: Record<string, number> };
        try {
          result = JSON.parse(textContent || '{}');
        } catch (parseError) {
          logger.error(`[Quality Rating] Failed to parse JSON for post ${post.id}`);
          continue;
        }

        // Validate the rating
        if (typeof result.rating !== 'number' || result.rating < 1 || result.rating > 5) {
          logger.error(`[Quality Rating] Invalid rating for post ${post.id}: ${result.rating}`);
          continue;
        }

        await prisma.qualityRating.create({
          data: {
            postId: post.id,
            rating: Math.round(result.rating),
            factors: JSON.stringify(result.factors),
          },
        });

        rated++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[Quality Rating] Failed to rate post ${post.id}: ${message}`);
      }
    }

    if (rated > 0) {
      await logSystemEvent('classify', `Quality rated ${rated} posts`);
      logger.info(`[Quality Rating] Rated ${rated} posts`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Quality Rating] Error: ${message}`);
    await logSystemEvent('error', `Quality rating failed: ${message}`);
  } finally {
    await releaseLock(LOCK_NAME);
  }
};

// Schedule: Run every 15 minutes
const schedule = process.env.QUALITY_RATING_CRON_SCHEDULE || '*/15 * * * *';

export const startQualityRatingCron = () => {
  cron.schedule(schedule, () => {
    (async () => {
      try {
        logger.debug('[Quality Rating] Cron triggered');
        await rateQuality();
      } catch (error) {
        logger.error(`[Quality Rating] Unhandled cron error: ${(error as Error).message}`);
      }
    })();
  });

  logger.info(`[Quality Rating] Cron scheduled: ${schedule}`);
};

export default { rateQuality, startQualityRatingCron };
