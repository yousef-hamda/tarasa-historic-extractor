import { chromium } from 'playwright';
import prisma from '../database/prisma';
import logger from '../utils/logger';
import { selectors } from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import fs from 'fs/promises';
import path from 'path';

const cookiesPath = path.resolve(__dirname, '../config/cookies.json');

const loadCookies = async () => {
  try {
    const raw = await fs.readFile(cookiesPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
};

const checkMessageQuota = async (): Promise<boolean> => {
  const max = Number(process.env.MAX_MESSAGES_PER_DAY || 20);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const count = await prisma.messageSent.count({
    where: { sentAt: { gte: since }, status: 'sent' },
  });
  return count < max;
};

export const sendMessage = async (authorLink: string, message: string, postId: number) => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const cookies = await loadCookies();
  if (cookies.length) {
    await context.addCookies(cookies);
  }

  const page = await context.newPage();
  await page.goto(authorLink, { waitUntil: 'domcontentloaded' });
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

  await page.waitForSelector(selectors.messengerTextarea);
  await page.fill(selectors.messengerTextarea, message);
  await page.keyboard.press('Enter');
  await humanDelay();

  await browser.close();

  await prisma.messageSent.create({
    data: {
      postId,
      authorLink,
      status: 'sent',
    },
  });
};

export const dispatchMessages = async () => {
  const quotaAvailable = await checkMessageQuota();
  if (!quotaAvailable) {
    logger.warn('Daily message quota reached');
    return;
  }

  const pending = await prisma.messageGenerated.findMany({
    take: 5,
  });

  for (const candidate of pending) {
    const post = await prisma.postRaw.findUnique({ where: { id: candidate.postId } });
    if (!post?.authorLink) {
      continue;
    }

    try {
      await sendMessage(post.authorLink, candidate.messageText, candidate.postId);
      await prisma.messageGenerated.delete({ where: { id: candidate.id } });
    } catch (error) {
      logger.error(`Failed to send message: ${error}`);
      await prisma.messageSent.create({
        data: {
          postId: candidate.postId,
          authorLink: post.authorLink,
          status: 'error',
          error: (error as Error).message,
        },
      });
    }
  }
};
