import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { retry } from '../utils/retry';

const prompt = `Generate a friendly and personalized Arabic message.
Do NOT sound like AI.
Target: Facebook users who wrote a historical post.

Goals:
1. Compliment the user.
2. Explain that Tarasa preserves historical stories.
3. Encourage them to submit their story.
4. Include pre-filled link: {dynamic_link}
5. Keep message short, polite, and natural.
6. Randomize synonyms so no two messages are identical.`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const buildLink = (postId: number, text: string) => {
  const base = process.env.BASE_TARASA_URL || 'https://tarasa.com/add-story';
  const encoded = encodeURIComponent(text);
  return `${base}?refPost=${postId}&text=${encoded}`;
};

const generateMessage = async (link: string) => {
  const completion = await retry(
    () =>
      openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: prompt.replace('{dynamic_link}', link),
          },
          {
            role: 'user',
            content: 'اكتب رسالة قصيرة تلهم الكاتب لمشاركة قصته التاريخية',
          },
        ],
      }),
    3,
    1500,
  );

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Message generation returned empty content');
  }
  return content;
};

export const generateMessages = async () => {
  const candidates = await prisma.postClassified.findMany({
    where: { isHistoric: true, confidence: { gte: 75 } },
    include: { post: true },
    orderBy: { classifiedAt: 'asc' },
    take: 10,
  });

  if (!candidates.length) {
    logger.info('No qualified posts for message generation');
    return;
  }

  let generated = 0;

  for (const item of candidates) {
    if (!item.post) continue;

    const alreadyGenerated = await prisma.messageGenerated.findFirst({
      where: { postId: item.postId },
    });
    if (alreadyGenerated) continue;

    const alreadySent = await prisma.messageSent.findFirst({
      where: { postId: item.postId, status: 'sent' },
    });
    if (alreadySent) continue;

    const link = buildLink(item.postId, item.post.text);

    try {
      const text = await generateMessage(link);

      await prisma.messageGenerated.create({
        data: {
          postId: item.postId,
          messageText: text.trim(),
          link,
        },
      });
      generated += 1;
    } catch (error) {
      logger.error(`Failed to generate message for post ${item.postId}: ${error}`);
      await logSystemEvent('error', `Message generation failed for post ${item.postId}: ${(error as Error).message}`);
    }
  }

  if (generated) {
    await logSystemEvent('message', `Generated ${generated} personalized messages`);
  }
};
