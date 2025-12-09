import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { callOpenAIWithRetry } from '../utils/openaiRetry';
import { normalizeMessageContent, validateGeneratedMessage } from '../utils/openaiHelpers';

const TEMPLATE_PROMPT = `You write short, warm, friendly English outreach messages to Facebook users who just shared a historic memory or story.

Your goals:
1. Address the person by their first name (provided in the author name field) in a friendly way.
2. Genuinely compliment their post in a casual, human tone - mention something specific about what they shared.
3. Briefly explain what Tarasa does: "Tarasa is a platform dedicated to preserving community history and personal stories for future generations."
4. Warmly invite them to share their full story on our website using the provided link.
5. Keep it friendly, personal, and under 4-5 sentences. Do NOT sound like a bot or AI.
6. End with the link naturally integrated into the message.
7. Vary your wording so consecutive messages sound different.

Respond with only the final message text in English.`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_GENERATOR_MODEL || 'gpt-4o-mini';
const MAX_BATCH = Number(process.env.GENERATOR_BATCH_SIZE ?? '10');

const buildLink = (postId: number, text: string) => {
  const base = process.env.BASE_TARASA_URL || 'https://tarasa.com/add-story';
  return `${base}?refPost=${postId}&text=${encodeURIComponent(text)}`;
};


export const generateMessages = async (): Promise<void> => {
  const classifiedPosts = await prisma.postClassified.findMany({
    where: {
      isHistoric: true,
      confidence: { gte: 75 },
      post: {
        generated: { none: {} },
        messages: { none: { status: 'sent' } },
      },
    },
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
    const link = buildLink(post.id, post.text);

    try {
      const authorName = post.authorName || 'Friend';
      // Get first name - handle single-word names and various formats
      const nameParts = authorName.trim().split(/\s+/);
      const firstName = nameParts[0] || 'Friend';

      const completion = await callOpenAIWithRetry(() =>
        openai.chat.completions.create({
          model,
          temperature: 0.8,
          messages: [
            { role: 'system', content: TEMPLATE_PROMPT },
            {
              role: 'user',
              content: `Author name: ${firstName}\nOriginal post: ${post.text}\nLink to share story: ${link}`,
            },
          ],
        }),
      );

      const rawContent = completion.choices[0]?.message?.content;
      const messageText = normalizeMessageContent(rawContent).trim();

      if (!messageText) {
        logger.warn(`OpenAI returned empty message for post ${post.id}`);
        await logSystemEvent('error', `Empty message generated for post ${post.id} - skipped`);
        continue;
      }

      // Validate the generated message contains the link
      const baseTarasaUrl = process.env.BASE_TARASA_URL || 'https://tarasa.com';
      if (!validateGeneratedMessage(messageText, baseTarasaUrl)) {
        logger.warn(`Generated message for post ${post.id} is too short or missing link`);
        await logSystemEvent('error', `Invalid message generated for post ${post.id} - skipped`);
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
