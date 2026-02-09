/**
 * AI Duplicate Detection Cron Job
 *
 * Identifies potential duplicate stories using text similarity
 * Uses a combination of:
 * 1. Exact match detection (after normalization)
 * 2. Similarity scoring using text comparison
 */

import cron from 'node-cron';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { logSystemEvent } from '../utils/systemLog';
import { acquireLock, releaseLock } from '../utils/cronLock';

const LOCK_NAME = 'duplicate-detection';
const SIMILARITY_THRESHOLD = 0.75; // 75% similarity to flag as potential duplicate
const BATCH_SIZE = 50;

/**
 * Normalize text for comparison
 * - Removes extra whitespace
 * - Converts to lowercase
 * - Removes common punctuation
 */
const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[\s\n\r\t]+/g, ' ')
    .replace(/[.,!?;:'"()[\]{}]/g, '')
    .trim();
};

/**
 * Generate n-grams from text
 */
const generateNgrams = (text: string, n: number = 3): Set<string> => {
  const words = text.split(' ').filter((w) => w.length > 0);
  const ngrams = new Set<string>();

  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }

  return ngrams;
};

/**
 * Calculate Jaccard similarity between two sets
 */
const jaccardSimilarity = (set1: Set<string>, set2: Set<string>): number => {
  if (set1.size === 0 && set2.size === 0) return 1;
  if (set1.size === 0 || set2.size === 0) return 0;

  let intersectionSize = 0;
  for (const item of set1) {
    if (set2.has(item)) {
      intersectionSize++;
    }
  }

  const unionSize = set1.size + set2.size - intersectionSize;
  return intersectionSize / unionSize;
};

/**
 * Calculate text similarity using multiple methods
 */
const calculateSimilarity = (text1: string, text2: string): number => {
  const norm1 = normalizeText(text1);
  const norm2 = normalizeText(text2);

  // Exact match after normalization
  if (norm1 === norm2) return 1;

  // If texts are very different in length, they're probably not duplicates
  const lengthRatio = Math.min(norm1.length, norm2.length) / Math.max(norm1.length, norm2.length);
  if (lengthRatio < 0.3) return 0;

  // Use 3-gram similarity
  const ngrams1 = generateNgrams(norm1, 3);
  const ngrams2 = generateNgrams(norm2, 3);

  const ngramSimilarity = jaccardSimilarity(ngrams1, ngrams2);

  // Also check word-level similarity
  const words1 = new Set(norm1.split(' '));
  const words2 = new Set(norm2.split(' '));
  const wordSimilarity = jaccardSimilarity(words1, words2);

  // Weighted average (n-grams are more reliable for catching reworded duplicates)
  return ngramSimilarity * 0.6 + wordSimilarity * 0.4;
};

/**
 * Find potential duplicates for a batch of posts
 */
const findDuplicates = async (posts: Array<{ id: number; text: string }>): Promise<void> => {
  // Check for duplicates within the batch and against existing posts
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];

    // Skip if already in a duplicate group
    const existing = await prisma.duplicateMatch.findFirst({
      where: { postId: post.id },
    });

    if (existing) continue;

    // Compare against other posts
    const candidates = await prisma.postRaw.findMany({
      where: {
        id: { not: post.id },
        classified: { isHistoric: true },
      },
      select: { id: true, text: true },
      orderBy: { scrapedAt: 'desc' },
      take: 200, // Only check recent posts for efficiency
    });

    for (const candidate of candidates) {
      // Skip if already in same group
      const inSameGroup = await prisma.duplicateMatch.findFirst({
        where: {
          postId: candidate.id,
          group: {
            posts: { some: { postId: post.id } },
          },
        },
      });

      if (inSameGroup) continue;

      const similarity = calculateSimilarity(post.text, candidate.text);

      if (similarity >= SIMILARITY_THRESHOLD) {
        logger.info(
          `[Duplicate Detection] Found potential duplicate: Post ${post.id} and ${candidate.id} (${(similarity * 100).toFixed(1)}% similar)`
        );

        // Check if candidate already has a group
        const candidateGroup = await prisma.duplicateMatch.findFirst({
          where: { postId: candidate.id },
          include: { group: true },
        });

        if (candidateGroup) {
          // Add to existing group
          await prisma.duplicateMatch.create({
            data: {
              groupId: candidateGroup.groupId,
              postId: post.id,
              similarity,
            },
          });
        } else {
          // Create new group
          await prisma.duplicateGroup.create({
            data: {
              primaryPostId: candidate.id, // Older post is primary
              similarity,
              posts: {
                create: [
                  { postId: candidate.id, similarity: 1 },
                  { postId: post.id, similarity },
                ],
              },
            },
          });
        }

        break; // Only add to one group
      }
    }
  }
};

/**
 * Main duplicate detection function
 */
export const detectDuplicates = async (): Promise<void> => {
  const hasLock = await acquireLock(LOCK_NAME);
  if (!hasLock) {
    logger.debug('[Duplicate Detection] Another instance is running, skipping');
    return;
  }

  try {
    // Get recent historic posts that haven't been checked for duplicates
    const recentPosts = await prisma.postRaw.findMany({
      where: {
        classified: {
          isHistoric: true,
          confidence: { gte: 75 },
        },
        // Posts not already in a duplicate group
        AND: {
          NOT: {
            id: {
              in: await prisma.duplicateMatch
                .findMany({ select: { postId: true } })
                .then((matches) => matches.map((m) => m.postId)),
            },
          },
        },
      },
      select: { id: true, text: true },
      orderBy: { scrapedAt: 'desc' },
      take: BATCH_SIZE,
    });

    if (recentPosts.length === 0) {
      logger.debug('[Duplicate Detection] No new posts to check');
      return;
    }

    logger.info(`[Duplicate Detection] Checking ${recentPosts.length} posts for duplicates`);

    await findDuplicates(recentPosts);

    // Count new duplicates found
    const duplicateGroups = await prisma.duplicateGroup.count({
      where: { status: 'pending' },
    });

    if (duplicateGroups > 0) {
      await logSystemEvent('classify', `Found ${duplicateGroups} potential duplicate groups`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Duplicate Detection] Error: ${message}`);
    await logSystemEvent('error', `Duplicate detection failed: ${message}`);
  } finally {
    await releaseLock(LOCK_NAME);
  }
};

// Schedule: Run every 30 minutes
const schedule = process.env.DUPLICATE_DETECTION_CRON_SCHEDULE || '*/30 * * * *';

export const startDuplicateDetectionCron = () => {
  cron.schedule(schedule, () => {
    (async () => {
      try {
        logger.debug('[Duplicate Detection] Cron triggered');
        await detectDuplicates();
      } catch (error) {
        logger.error(`[Duplicate Detection] Unhandled cron error: ${(error as Error).message}`);
      }
    })();
  });

  logger.info(`[Duplicate Detection] Cron scheduled: ${schedule}`);
};

export default { detectDuplicates, startDuplicateDetectionCron };
