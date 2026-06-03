import OpenAI from 'openai';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { callOpenAIWithRetry } from '../utils/openaiRetry';
import { normalizeMessageContent, validateClassificationResult, sanitizeForPrompt, getModel } from '../utils/openaiHelpers';

const CLASSIFICATION_PROMPT = `You are an expert curator for Tarasa, a project that PRESERVES SUBSTANTIVE PERSONAL HISTORICAL STORIES from Israeli community Facebook groups.

Your job is to decide whether a Facebook post is a FULL HISTORICAL STORY worth preserving — not just any post that touches on history. Most posts in history-themed groups are NOT full stories; they are announcements, requests, captions, or pointers.

================================================================
WHEN TO ASSIGN confidence > 75 (the "yes, this is a story" range)
================================================================
ALL of the following MUST be true:
  1. NARRATIVE: the post tells a story, recounts a memory, or describes
     an experience — there's a chronological or descriptive arc.
  2. SPECIFICITY: it names a concrete event, person, place, period, or
     incident from the past. Not a generic gesture toward history.
  3. SUBSTANCE: the body is several sentences of actual content (not a
     single line, not a caption under a photo, not a question).
  4. PERSONAL OR COMMUNITY MEMORY: it's first-hand, second-hand, or
     local oral history — someone actually has something to share, not
     just a citation of facts everyone already knows.

If even ONE of the four is missing, confidence MUST be 75 or below.

Use this scale inside the >75 range:
  76–85 : a real story, but short or with limited detail.
  86–94 : a clearly developed personal/community memory with detail.
  95–100: a full, vivid, multi-paragraph story — the kind we exist to
          preserve. Be sparing with this range.

================================================================
WHEN TO ASSIGN confidence ≤ 75 (the "not a full story" range)
================================================================
0–25  : completely unrelated to history (e.g. unrelated chatter, ads).

26–50 : nominally history-themed but clearly NOT a story to preserve:
  • Event announcements, tours, exhibitions, invitations.
  • Group rules, moderator notices, group descriptions.
  • Calls for submissions ("does anyone have photos of...?",
    "share your memories of X").
  • Copyright notices, credits requests, link-only posts.
  • Single-photo captions or one-line references.
  • Commercial / promotional content even if museum-themed.

51–75 : the post DOES brush against historical content but is too
        thin to count as a story:
  • A short evocative memory with no detail.
  • A factual historical claim without personal context.
  • A historical photo with a brief caption ("X street, 1953").
  • A genuine question about history with no story attached.

================================================================
GUT CHECK (always apply this before answering)
================================================================
Would you describe this post to a colleague as "a real historical
story worth saving"? If yes → confidence > 75. If you would describe
it as "a request for info" / "an event listing" / "a short caption" /
"someone mentioning history in passing" → confidence MUST be ≤ 75,
regardless of how history-themed the topic seems.

Be CONSERVATIVE. Tarasa would rather miss a borderline post than spam
the author of every event announcement. When in doubt, score it lower.

Output strict JSON matching the schema. The "reason" should name the
single most important signal you used (e.g. "single-line caption, no
narrative" or "detailed first-hand memory of 1967 with specific
people and places").`;

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

const model = getModel('classifier');
// Increased default batch size for better throughput (was 10)
const parsedBatchSize = Number(process.env.CLASSIFIER_BATCH_SIZE ?? '25');
const BATCH_SIZE = Math.min(isNaN(parsedBatchSize) ? 25 : parsedBatchSize, 50);

/**
 * Validate confidence score is within valid range
 */
const validateConfidence = (confidence: number): number => {
  if (typeof confidence !== 'number' || isNaN(confidence)) {
    logger.warn(`[Classifier] Invalid confidence value received: ${confidence}, defaulting to 0`);
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(confidence)));
};


export const classifyPosts = async (): Promise<void> => {
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
            { role: 'user', content: sanitizeForPrompt(post.text) },
          ],
        }),
      );

      const rawContent = completion.choices[0]?.message?.content;
      const textContent = normalizeMessageContent(rawContent);

      let rawParsed: unknown;
      try {
        rawParsed = JSON.parse(textContent || '{}');
      } catch (parseError) {
        logger.error(`Failed to parse classification JSON for post ${post.id}: ${textContent}`);
        await logSystemEvent('error', `JSON parse error for post ${post.id}`);
        continue;
      }

      // Validate the parsed result has the expected structure
      const validated = validateClassificationResult(rawParsed);
      if (!validated) {
        logger.error(`Invalid classification structure for post ${post.id}: ${JSON.stringify(rawParsed)}`);
        await logSystemEvent('error', `Invalid classification structure for post ${post.id}`);
        continue;
      }

      await prisma.postClassified.create({
        data: {
          postId: post.id,
          isHistoric: validated.is_historic,
          confidence: validateConfidence(validated.confidence),
          reason: validated.reason,
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

// Execute when run directly via npm run classify
if (require.main === module) {
  require('dotenv/config');
  classifyPosts()
    .then(async () => {
      logger.info('Classification completed');
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error(`Classification failed: ${error.message}`);
      await prisma.$disconnect();
      process.exit(1);
    });
}
