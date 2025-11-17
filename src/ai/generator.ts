import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { callOpenAIWithRetry } from '../utils/openaiRetry';

const TEMPLATE_PROMPT = `You write short, warm Arabic outreach messages to Facebook users who just shared a historic memory.
Your goals:
1. Genuinely compliment the post in a casual, human tone.
2. Mention that Tarasa preserves community history.
3. Invite them to submit their story through the provided link.
4. Keep it under 3 sentences and avoid sounding like AI.
5. Randomize wording so consecutive outputs differ.
Respond with only the final message text.`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_GENERATOR_MODEL || 'gpt-4o-mini';
const MAX_BATCH = Number(process.env.GENERATOR_BATCH_SIZE ?? '10');

const buildLink = (postId: number, text: string) => {
  const base = process.env.BASE_TARASA_URL || 'https://tarasa.com/add-story';
  return `${base}?refPost=${postId}&text=${encodeURIComponent(text)}`;
};

const normalizeMessageContent = (
  content?: string | null | Array<{ type: string; text?: string }>,
) => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  const textChunk = content.find((chunk) => chunk.type === 'text');
  return textChunk?.text ?? '';
};

export const generateMessages = async () => {
  const classifiedPosts = await prisma.postClassified.findMany({
    where: { isHistoric: true, confidence: { gte: 75 } },
    include: { post: true },
    orderBy: { classifiedAt: 'asc' },
    take: MAX_BATCH,
  });

  if (!classifiedPosts.length) {
    logger.info('No qualified posts for message generation');
    return;
  }

  let generated = 0;

  for (const classification of classifiedPosts) {
    if (!classification.post) continue;

    const { post } = classification;

    const existingGenerated = await prisma.messageGenerated.findFirst({
      where: { postId: post.id },
    });
    if (existingGenerated) continue;

    const alreadySent = await prisma.messageSent.findFirst({
      where: { postId: post.id, status: 'sent' },
    });
    if (alreadySent) continue;

    const link = buildLink(post.id, post.text);

    try {
      const completion = await callOpenAIWithRetry(() =>
        openai.chat.completions.create({
          model,
          temperature: 0.8,
          messages: [
            { role: 'system', content: TEMPLATE_PROMPT },
            {
              role: 'user',
              content: `Original post: ${post.text}\nCTA link: ${link}`,
            },
          ],
        }),
      );

      const rawContent = completion.choices[0]?.message?.content;
      const messageText = normalizeMessageContent(rawContent).trim();

      if (!messageText) {
        logger.warn(`OpenAI returned empty message for post ${post.id}`);
        continue;
      }

      await prisma.messageGenerated.create({
        data: {
          postId: post.id,
          messageText,
          link,
        },
      });

      generated += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to generate message for post ${post.id}: ${message}`);
      await logSystemEvent('error', `Message generation failed for post ${post.id}: ${message}`);
    }
  }

  if (generated) {
    await logSystemEvent('message', `Generated ${generated} personalized messages`);
  }
};
