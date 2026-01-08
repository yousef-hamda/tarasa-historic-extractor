import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { callOpenAIWithRetry } from '../utils/openaiRetry';
import { normalizeMessageContent, validateGeneratedMessage } from '../utils/openaiHelpers';

const TEMPLATE_PROMPT = `أنت تكتب رسائل قصيرة ودودة بالعربية إلى أشخاص على فيسبوك شاركوا قصة أو ذكرى تاريخية.

القواعد:
1) خاطِب الشخص باسمه الأول بلطف وبلهجة طبيعية.
2) امدح ما شاركه بشكل محدد (إشارة إلى القصة أو ذكرياته).
3) عرّف باختصار بمنصة تراسا: "منصة تراسا مخصصة لحفظ التاريخ المجتمعي والذكريات الشخصية للأجيال القادمة".
4) ادعُه لمشاركة قصته كاملة عبر الرابط المرفق، واجعل الرابط جزءاً طبيعياً من النص.
5) اجعل الرسالة إنسانية وغير روبوتية، متنوعة الصياغة، وبطول 3-5 جمل قصيرة.
6) لا تستخدم رموزاً تعبيرية مكررة أو صيغ رسمية مفرطة.

أرسل فقط نص الرسالة النهائي باللغة العربية متضمناً الرابط المقدم.`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_GENERATOR_MODEL || 'gpt-4o-mini';
const MAX_BATCH = Number(process.env.GENERATOR_BATCH_SIZE ?? '10');

const buildLink = (postId: number, text: string) => {
  const base = process.env.BASE_TARASA_URL || 'https://tarasa.me/he/premium/5d5252bf574a2100368f9833';
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
      const baseTarasaUrl = process.env.BASE_TARASA_URL || 'https://tarasa.me/he/premium/5d5252bf574a2100368f9833';
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
