import prisma from '../database/prisma';
import logger from '../utils/logger';
import { selectors } from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import { createFacebookContext, saveCookies } from '../facebook/session';
import { logSystemEvent } from '../utils/systemLog';

const getRemainingMessageQuota = async (): Promise<number> => {
  const max = Number(process.env.MAX_MESSAGES_PER_DAY || 20);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.messageSent.count({
    where: { sentAt: { gte: since }, status: 'sent' },
  });
  return Math.max(0, max - count);
};

export const dispatchMessages = async () => {
  let remaining = await getRemainingMessageQuota();
  if (remaining <= 0) {
    logger.warn('Daily message quota reached');
    await logSystemEvent('message', 'Daily message quota reached. Dispatch aborted.');
    return;
  }

  const pending = await prisma.messageGenerated.findMany({
    orderBy: { createdAt: 'asc' },
    take: remaining,
  });

  if (!pending.length) {
    logger.info('No generated messages to dispatch');
    return;
  }

  const { browser, context } = await createFacebookContext();
  const page = await context.newPage();

  try {
    for (const candidate of pending) {
      const post = await prisma.postRaw.findUnique({ where: { id: candidate.postId } });
      if (!post?.authorLink) {
        await logSystemEvent('message', `Skipped message for post ${candidate.postId}; missing author link.`);
        continue;
      }

      if (remaining <= 0) {
        break;
      }

      try {
        await page.goto(post.authorLink, { waitUntil: 'domcontentloaded' });
        await humanDelay();

        let clicked = false;
        for (const selector of selectors.messengerButtons) {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            clicked = true;
            break;
          }
        }

        if (!clicked) {
          throw new Error('Unable to locate message button');
        }

        await page.waitForSelector(selectors.messengerTextarea, { timeout: 15000 });
        await page.fill(selectors.messengerTextarea, candidate.messageText);
        await humanDelay();
        await page.keyboard.press('Enter');
        await humanDelay();

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
      } catch (error) {
        logger.error(`Failed to send message for post ${candidate.postId}: ${error}`);
        await prisma.messageSent.create({
          data: {
            postId: candidate.postId,
            authorLink: post.authorLink,
            status: 'error',
            error: (error as Error).message,
          },
        });
        await logSystemEvent('error', `Message dispatch failed for post ${candidate.postId}: ${(error as Error).message}`);
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
