import { Request, Response, Router } from 'express';
import prisma from '../database/prisma';
import { parsePositiveInt, parseNonNegativeInt } from '../utils/validation';
import { safeErrorMessage } from '../middleware/errorHandler';
import { apiKeyAuth } from '../middleware/apiAuth';
import { triggerRateLimiter } from '../middleware/rateLimiter';
import { logSystemEvent } from '../utils/systemLog';
import logger from '../utils/logger';

const router = Router();

// Max length for an edited outreach message — guards against accidental paste
// of a huge blob and keeps the Messenger composer happy.
const MAX_MESSAGE_LENGTH = 5000;

router.get('/api/messages', async (req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const queueLimit = parsePositiveInt(req.query.queueLimit, 50, 200);
    const sentLimit = parsePositiveInt(req.query.sentLimit, 200, 500);
    const sentOffset = parseNonNegativeInt(req.query.sentOffset, 0);

    const [queue, sent, sentLast24h, totalSent] = await Promise.all([
      prisma.messageGenerated.findMany({
        orderBy: { createdAt: 'desc' },
        take: queueLimit,
        include: { post: true },
      }),
      prisma.messageSent.findMany({
        orderBy: { sentAt: 'desc' },
        take: sentLimit,
        skip: sentOffset,
        include: { post: true },
      }),
      prisma.messageSent.count({
        where: { sentAt: { gte: since }, status: 'sent' },
      }),
      prisma.messageSent.count(),
    ]);

    res.json({
      queue,
      sent,
      stats: {
        queue: queue.length,
        sentLast24h,
      },
      pagination: {
        sentTotal: totalSent,
        sentLimit,
        sentOffset,
        hasMore: sentOffset + sent.length < totalSent,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: 'Failed to fetch messages', message: safeErrorMessage(error, 'Internal server error') });
  }
});

/**
 * Edit the AI-generated text of a queued message before it's sent. Gated by
 * the API key. The admin opens the message on the Messages page, tweaks the
 * wording, and saves — the next dispatch (or a manual send) uses the new text.
 */
router.patch('/api/messages/:id', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    const text = typeof req.body?.messageText === 'string' ? req.body.messageText : '';
    const trimmed = text.trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Empty message', message: 'messageText cannot be empty.' });
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: 'Message too long', message: `Keep it under ${MAX_MESSAGE_LENGTH} characters.` });
    }

    const existing = await prisma.messageGenerated.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Not found', message: 'This queued message no longer exists (it may have been sent).' });
    }

    const updated = await prisma.messageGenerated.update({
      where: { id },
      data: { messageText: trimmed },
      include: { post: true },
    });
    await logSystemEvent('message', `Queued message ${id} (post ${updated.postId}) edited by admin`);
    return res.json({ success: true, message: updated });
  } catch (error) {
    logger.error(`[messages] edit failed: ${(error as Error).message}`);
    return res.status(500).json({ error: 'Failed to edit message', message: safeErrorMessage(error, 'Internal server error') });
  }
});

/**
 * Manually send ONE queued message right now (admin pressed "Send" on a
 * specific message). Bypasses the global pause + daily quota since it's an
 * explicit action, but still records to MessageSent. Gated by the API key.
 */
router.post('/api/messages/:id/send', apiKeyAuth, triggerRateLimiter, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid message id' });
    }
    const { sendGeneratedMessageNow } = await import('../messenger/messenger');
    const result = await sendGeneratedMessageNow(id);
    if (!result.success) {
      return res.status(502).json({ success: false, error: 'Send failed', message: result.error });
    }
    return res.json({ success: true, message: 'Message sent.' });
  } catch (error) {
    logger.error(`[messages] manual send failed: ${(error as Error).message}`);
    return res.status(500).json({ error: 'Failed to send message', message: safeErrorMessage(error, 'Internal server error') });
  }
});

export default router;
