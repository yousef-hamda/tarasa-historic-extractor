import prisma from '../database/prisma';
import logger from '../utils/logger';
import {
  selectors,
  clickFirstMatchingSelector,
  waitForFirstMatchingSelector,
  fillFirstMatchingSelector,
} from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import { createFacebookContext, saveCookies } from '../facebook/session';
import { logSystemEvent } from '../utils/systemLog';
import { TIMEOUTS, QUOTA } from '../config/constants';

const getRemainingMessageQuota = async (): Promise<number> => {
  const max = Number(process.env.MAX_MESSAGES_PER_DAY) || QUOTA.DEFAULT_MAX_PER_DAY;
  const since = new Date(Date.now() - QUOTA.WINDOW_MS);
  const count = await prisma.messageSent.count({
    where: { sentAt: { gte: since }, status: 'sent' },
  });
  return Math.max(0, max - count);
};

export const dispatchMessages = async (): Promise<void> => {
  let remaining = await getRemainingMessageQuota();
  if (remaining <= 0) {
    logger.warn('Daily message quota reached');
    await logSystemEvent('message', 'Daily message quota reached. Dispatch aborted.');
    return;
  }

  const pending = await prisma.messageGenerated.findMany({
    orderBy: { createdAt: 'asc' },
    take: remaining,
    include: { post: true },
  });

  if (!pending.length) {
    logger.info('No generated messages to dispatch');
    return;
  }

  const { browser, context } = await createFacebookContext();
  const page = await context.newPage();

  try {
    for (const candidate of pending) {
      const post = candidate.post;
      if (!post?.authorLink) {
        await logSystemEvent('message', `Skipped message for post ${candidate.postId}; missing author link.`);
        continue;
      }

      if (remaining <= 0) {
        break;
      }

      let messageSentSuccessfully = false;
      let sendError: Error | null = null;

      try {
        await page.goto(post.authorLink, { waitUntil: 'domcontentloaded' });
        await humanDelay();

        await clickFirstMatchingSelector(page, selectors.messengerButtons);
        await waitForFirstMatchingSelector(page, selectors.messengerTextarea, { timeout: TIMEOUTS.SHORT_WAIT });
        await fillFirstMatchingSelector(page, selectors.messengerTextarea, candidate.messageText);
        await humanDelay();
        await page.keyboard.press('Enter');
        await humanDelay();

        messageSentSuccessfully = true;
      } catch (error) {
        sendError = error as Error;
        logger.error(`Failed to send message for post ${candidate.postId}: ${sendError.message}`);
      }

      // Record result in database (only one record per attempt)
      try {
        if (messageSentSuccessfully) {
          await prisma.messageSent.create({
            data: {
              postId: candidate.postId,
              authorLink: post.authorLink,
              status: 'sent',
            },
          });
          await prisma.messageGenerated.delete({ where: { id: candidate.id } });
          remaining -= 1;
          await logSystemEvent('message', `Message sent for post ${candidate.postId}`);
        } else {
          await prisma.messageSent.create({
            data: {
              postId: candidate.postId,
              authorLink: post.authorLink,
              status: 'error',
              error: sendError?.message || 'Unknown error',
            },
          });
          // Keep the generated message for retry - don't delete it
          await logSystemEvent('error', `Message dispatch failed for post ${candidate.postId}: ${sendError?.message}`);
        }
      } catch (dbError) {
        logger.error(`Database error recording message status for post ${candidate.postId}: ${(dbError as Error).message}`);
      }

      if (remaining <= 0) {
        logger.info('Message quota exhausted during dispatch loop');
        break;
      }

      await humanDelay();
    }
  } finally {
    await saveCookies(context);
    await browser.close();
  }
};
