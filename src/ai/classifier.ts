import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { callOpenAIWithRetry } from '../utils/openaiRetry';

const CLASSIFICATION_PROMPT = `You are an expert Arabic-speaking community moderator for a historical storytelling project.
Classify whether the supplied Facebook post clearly references historical events or personal memories from the past.
Respond with JSON matching the schema.`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CLASSIFICATION_SCHEMA = {
  name: 'classification_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      is_historic: { type: 'boolean', description: 'Whether the content is historical in nature.' },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      reason: { type: 'string' },
    },
    required: ['is_historic', 'confidence', 'reason'],
  },
} as const;

const model = process.env.OPENAI_CLASSIFIER_MODEL || 'gpt-4o-mini';
const BATCH_SIZE = Number(process.env.CLASSIFIER_BATCH_SIZE ?? '10');

const normalizeMessageContent = (
  content?: string | null | Array<{ type: string; text?: string }>,
) => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const textChunk = content.find((chunk) => chunk.type === 'text');
  return textChunk?.text ?? '';
};

export const classifyPosts = async () => {
  const pendingPosts = await prisma.postRaw.findMany({
    where: { classified: null },
    orderBy: { scrapedAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (!pendingPosts.length) {
    logger.info('No posts pending classification');
    return;
  }

  let processed = 0;

  for (const post of pendingPosts) {
    try {
      const completion = await callOpenAIWithRetry(() =>
        openai.chat.completions.create({
          model,
          temperature: 0,
          response_format: { type: 'json_schema', json_schema: CLASSIFICATION_SCHEMA },
          messages: [
            { role: 'system', content: CLASSIFICATION_PROMPT },
            { role: 'user', content: post.text },
          ],
        }),
      );

      const rawContent = completion.choices[0]?.message?.content;
      const textContent = normalizeMessageContent(rawContent);
      const parsed = JSON.parse(textContent || '{}');

      await prisma.postClassified.create({
        data: {
          postId: post.id,
          isHistoric: Boolean(parsed.is_historic),
          confidence: Number(parsed.confidence) || 0,
          reason: parsed.reason || 'N/A',
        },
      });

      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to classify post ${post.id}: ${message}`);
      await logSystemEvent('error', `Failed to classify post ${post.id}: ${message}`);
    }
  }

  if (processed) {
    await logSystemEvent('classify', `Classified ${processed} posts`);
  }
};
