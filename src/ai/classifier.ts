import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';

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

export const classifyPosts = async () => {
  const unclassified = await prisma.postRaw.findMany({
    where: { classified: null },
    take: 10,
  });

  for (const post of unclassified) {
    try {
      const completion = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content: prompt,
          },
          {
            role: 'user',
            content: post.text,
          },
        ],
        response_format: { type: 'json_schema' },
      });

      const content = completion.output?.[0]?.content?.[0];
      const text = content && 'text' in content ? content.text : '{}';
      const parsed = JSON.parse(text);

      await prisma.postClassified.create({
        data: {
          postId: post.id,
          isHistoric: parsed.is_historic,
          confidence: parsed.confidence,
          reason: parsed.reason,
        },
      });
    } catch (error) {
      logger.error(`Failed to classify post ${post.id}: ${error}`);
    }
  }
};
