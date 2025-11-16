import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { retry } from '../utils/retry';

const prompt = `You are an expert classifier in historical storytelling.
Your task is to identify whether the given Facebook post describes:
1. A historical event, OR
2. A personal memory related to past events, OR
3. Any narrative referencing history or old times.

If yes → mark as is_historic = true.
Return ONLY JSON:
{
  "is_historic": true/false,
  "confidence": 0-100,
  "reason": "string"
}`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const parseClassification = (raw: string | null) => {
  if (!raw) {
    throw new Error('Classifier returned empty content');
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Unable to parse classifier response: ${(error as Error).message}`);
  }
};

export const classifyPosts = async () => {
  const unclassified = await prisma.postRaw.findMany({
    where: { classified: null },
    orderBy: { scrapedAt: 'asc' },
    take: 10,
  });

  if (!unclassified.length) {
    logger.info('No posts pending classification');
    return;
  }

  let processed = 0;

  for (const post of unclassified) {
    try {
      const completion = await retry(
        () =>
          openai.chat.completions.create({
            model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
            temperature: 0.2,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: prompt },
              { role: 'user', content: post.text },
            ],
          }),
        3,
        2000,
      );

      const content = completion.choices[0]?.message?.content?.trim() ?? null;
      const parsed = parseClassification(content);

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
      logger.error(`Failed to classify post ${post.id}: ${error}`);
      await logSystemEvent('error', `Failed to classify post ${post.id}: ${(error as Error).message}`);
    }
  }

  if (processed) {
    await logSystemEvent('classify', `Classified ${processed} posts`);
  }
};
