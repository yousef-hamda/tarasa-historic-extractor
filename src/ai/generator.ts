import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { callOpenAIWithRetry } from '../utils/openaiRetry';
import { normalizeMessageContent, validateGeneratedMessage, sanitizeForPrompt, getModel } from '../utils/openaiHelpers';
import { URLS } from '../config/constants';

const TEMPLATE_PROMPT = `You write short, friendly messages to people on Facebook who shared a historical story or memory.

CRITICAL: You MUST write the message in the SAME LANGUAGE as the original post:
- If the post is in Hebrew (עברית) → write the message in Hebrew
- If the post is in Arabic (العربية) → write the message in Arabic
- If the post is in English → write the message in English

Rules:
1) Address the person by their first name warmly and naturally.
2) Compliment what they shared specifically (reference their story or memories).
3) Briefly introduce Tarasa platform:
   - Hebrew: "פלטפורמת טראסא מוקדשת לשימור ההיסטוריה הקהילתית והזכרונות האישיים לדורות הבאים"
   - Arabic: "منصة تراسا مخصصة لحفظ التاريخ المجتمعي والذكريات الشخصية للأجيال القادمة"
   - English: "Tarasa platform is dedicated to preserving community history and personal memories for future generations"
4) Invite them to share their full story via the provided link, making the link a natural part of the text.
5) Keep the message human and not robotic, varied in phrasing, 3-5 short sentences.
6) Don't use repetitive emojis or overly formal phrases.

Return ONLY the final message text in the SAME LANGUAGE as the original post, including the provided link.`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = getModel('generator');
// Increased default batch size for better throughput (was 10)
const parsedBatchSize = Number(process.env.GENERATOR_BATCH_SIZE ?? '20');
const MAX_BATCH = Math.min(isNaN(parsedBatchSize) ? 20 : parsedBatchSize, 50);

// Use centralized URL from constants
const DEFAULT_TARASA_URL = URLS.DEFAULT_TARASA;

/**
 * Build the link to be included in the message
 *
 * If SUBMIT_PAGE_BASE_URL is set, use the landing page which:
 * - Shows the post text
 * - Has a "Copy to Clipboard" button
 * - Redirects to tarasa.me
 *
 * Otherwise, fall back to direct tarasa.me link (legacy behavior)
 */
const buildLink = (postId: number, text: string) => {
  // Check if landing page is configured
  const submitPageBase = process.env.SUBMIT_PAGE_BASE_URL;

  if (submitPageBase) {
    // Use the new landing page URL (no text in URL - fetched from DB)
    return `${submitPageBase.replace(/\/$/, '')}/submit/${postId}`;
  }

  // Legacy behavior: direct tarasa.me link with text in URL
  const base = process.env.BASE_TARASA_URL || DEFAULT_TARASA_URL;
  return `${base}?refPost=${postId}&text=${encodeURIComponent(text)}`;
};


export const generateMessages = async (): Promise<void> => {
  const classifiedPosts = await prisma.postClassified.findMany({
    where: {
      isHistoric: true,
      confidence: { gte: 75 },
      post: {
        authorLink: { not: null }, // Only fetch posts with author links
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
    if (!post.authorLink) {
      // Safety net - should not happen since we filter in query
      logger.debug(`Skipping generation for post ${post.id}; missing author link.`);
      continue;
    }
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
              content: `Author name: ${sanitizeForPrompt(firstName, 100)}\nOriginal post: ${sanitizeForPrompt(post.text)}\nLink to share story: ${link}`,
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
      const baseTarasaUrl = process.env.BASE_TARASA_URL || DEFAULT_TARASA_URL;
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

// Execute when run directly via npm run generate
if (require.main === module) {
  require('dotenv/config');
  generateMessages()
    .then(async () => {
      logger.info('Message generation completed');
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error(`Message generation failed: ${error.message}`);
      await prisma.$disconnect();
      process.exit(1);
    });
}
