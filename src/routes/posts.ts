import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
// Using hybrid scraper (Apify for public groups, Playwright for private groups)
import { scrapeAllGroups } from '../scraper/scrapeApifyToDb';
import { classifyPosts } from '../ai/classifier';
import { safeErrorMessage } from '../middleware/errorHandler';
import { generateMessages } from '../ai/generator';
import { dispatchMessages } from '../messenger/messenger';
import { logSystemEvent } from '../utils/systemLog';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { apiKeyAuth } from '../middleware/apiAuth';
import { parsePositiveInt, parseNonNegativeInt } from '../utils/validation';
import { isLocked, withLock } from '../utils/cronLock';
import { getHistoricThreshold } from '../utils/settings';
import { _shouldSkipPostForTests as shouldSkipPost } from '../scraper/orchestrator';
import logger from '../utils/logger';

const router = Router();

router.get('/api/posts', async (req: Request, res: Response) => {
  try {
    const limit = parsePositiveInt(req.query.limit, 100, 500);
    const offset = parseNonNegativeInt(req.query.offset, 0);

    const [posts, total, historicThreshold] = await Promise.all([
      prisma.postRaw.findMany({
        include: { classified: true },
        orderBy: { scrapedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.postRaw.count(),
      getHistoricThreshold(),
    ]);

    res.json({
      data: posts,
      // Include the threshold in the response so the posts table can render
      // the Historic / Below threshold badge without a second roundtrip.
      historicThreshold,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + posts.length < total,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch posts', message: safeErrorMessage(error, 'Internal server error') });
  }
});

router.post('/api/trigger-scrape', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    // Acquire the same lock the cron uses, so a manual trigger can't race
    // against an in-flight cron scrape (which would double-hit Facebook and
    // race on the post upserts).
    if (await isLocked('scrape')) {
      return res.status(409).json({
        error: 'Scrape already in progress',
        message: 'A scrape is already running (cron or another manual trigger). Try again in a few minutes.',
      });
    }
    await withLock('scrape', async () => {
      await scrapeAllGroups();
    });
    res.json({ status: 'completed' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    await logSystemEvent('error', `Manual scrape trigger failed: ${errMsg}`).catch(() => {});
    res.status(500).json({ error: 'Scrape failed', message: errMsg });
  }
});

router.post('/api/trigger-classification', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    await classifyPosts();
    res.json({ status: 'completed' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    await logSystemEvent('error', `Manual classification trigger failed: ${errMsg}`).catch(() => {});
    res.status(500).json({ error: 'Classification failed', message: errMsg });
  }
});

router.post('/api/trigger-message', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    await generateMessages();
    await dispatchMessages();
    res.json({ status: 'completed' });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    await logSystemEvent('error', `Manual message trigger failed: ${errMsg}`).catch(() => {});
    res.status(500).json({ error: 'Message dispatch failed', message: errMsg });
  }
});

// Bulk-cleanup endpoint. Runs the live `shouldSkipPost` filter against every
// post currently in the DB and deletes anything that would have been rejected
// at scrape time. This lets the operator wipe out the phantom rows seeded
// when the session-zombie bug was active, without paying the manual cost of
// finding them in the table. Same logic as the live filter, so the cleanup
// and the prevention can never drift apart.
router.post('/api/admin/cleanup-phantoms', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    // Best-effort identity from SessionState — same lookup the orchestrator
    // does at scrape time. Wrapped in catches so a missing/invalid row doesn't
    // crash the cleanup.
    let userId: string | null = null;
    let userName: string | null = null;
    try {
      const row = await prisma.sessionState.findFirst({ orderBy: { createdAt: 'desc' } });
      if (row) {
        if (row.userId && /^\d{5,}$/.test(row.userId) && row.userId !== '0') {
          userId = row.userId;
        }
        if (row.userName) userName = row.userName;
      }
    } catch {
      // proceed with both null
    }

    const allPosts = await prisma.postRaw.findMany({
      select: {
        id: true,
        fbPostId: true,
        groupId: true,
        authorName: true,
        authorLink: true,
        authorPhoto: true,
        text: true,
        postUrl: true,
      },
    });

    const toDelete: number[] = [];
    const reasons: Record<string, number> = {};
    for (const p of allPosts) {
      const decision = shouldSkipPost(
        {
          fbPostId: p.fbPostId,
          groupId: p.groupId,
          authorName: p.authorName,
          authorLink: p.authorLink,
          authorPhoto: p.authorPhoto,
          text: p.text,
          postUrl: p.postUrl,
        },
        { userId, userName },
      );
      if (decision.skip) {
        toDelete.push(p.id);
        const key = decision.reason ?? 'unknown';
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    }

    if (toDelete.length === 0) {
      return res.json({ success: true, deleted: 0, reasons: {} });
    }

    // Single bulk delete — cascade FKs handle dependents.
    const result = await prisma.postRaw.deleteMany({ where: { id: { in: toDelete } } });
    await logSystemEvent('admin', `Phantom cleanup removed ${result.count} posts. Reason histogram: ${JSON.stringify(reasons)}`);
    res.json({ success: true, deleted: result.count, reasons });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[posts] cleanup-phantoms failed: ${message}`);
    res.status(500).json({ error: 'Cleanup failed', message });
  }
});

// Backfill postUrl for existing rows. Until this commit, the upsert in
// orchestrator.ts was dropping the field on insert/update — so every row in
// the DB ended up with postUrl=null even when the fbPostId was a perfectly
// valid Facebook numeric id we could have linked to. This endpoint goes
// through every row where postUrl is null AND fbPostId is numeric (i.e. NOT
// our hash_<sha> fallback), constructs the canonical URL, and writes it.
// Hash-id rows are left alone — we can't link to a post we never got an id
// for. Returns the count of rows updated.
router.post('/api/admin/backfill-post-urls', apiKeyAuth, triggerRateLimiter, async (_req: Request, res: Response) => {
  try {
    const candidates = await prisma.postRaw.findMany({
      where: { postUrl: null },
      select: { id: true, groupId: true, fbPostId: true },
    });

    let updated = 0;
    let skippedHash = 0;
    let skippedNonNumeric = 0;
    for (const p of candidates) {
      if (p.fbPostId.startsWith('hash_')) {
        skippedHash++;
        continue;
      }
      if (!/^\d+$/.test(p.fbPostId)) {
        skippedNonNumeric++;
        continue;
      }
      await prisma.postRaw.update({
        where: { id: p.id },
        data: { postUrl: `https://www.facebook.com/groups/${p.groupId}/posts/${p.fbPostId}` },
      });
      updated++;
    }

    await logSystemEvent(
      'admin',
      `Backfilled postUrl on ${updated} posts (skipped ${skippedHash} hash-id rows, ${skippedNonNumeric} non-numeric)`,
    );
    res.json({
      success: true,
      updated,
      skippedHash,
      skippedNonNumeric,
      total: candidates.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[posts] backfill-post-urls failed: ${msg}`);
    res.status(500).json({ error: 'Backfill failed', message: msg });
  }
});

// Delete a single post by id. Cascades through classifications, generated and
// sent messages, and quality ratings (all FKs are `onDelete: Cascade` in the
// schema, but we wrap in a transaction for atomic visibility). Used by the
// Posts page row trash icon.
router.delete('/api/posts/:id', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  try {
    const existing = await prisma.postRaw.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Post not found' });
    }
    await prisma.postRaw.delete({ where: { id } });
    await logSystemEvent('admin', `Post ${id} deleted via API (${existing.authorName ?? 'no-author'})`);
    res.json({ success: true, deletedId: id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to delete post', message });
  }
});

export default router;
