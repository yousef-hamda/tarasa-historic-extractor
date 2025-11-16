import logger from '../utils/logger';
import { humanDelay } from '../utils/delays';
import { extractPosts } from './extractors';
import prisma from '../database/prisma';
import { createFacebookContext, saveCookies } from '../facebook/session';
import { logSystemEvent } from '../utils/systemLog';

const getGroupUrls = (): string[] => {
  const ids = (process.env.GROUP_IDS ?? '')
    .split(',')
    .map((id: string) => id.trim())
    .filter((id: string): id is string => Boolean(id));

  return ids.map((id: string) => `https://www.facebook.com/groups/${id}`);
};

export const scrapeGroups = async () => {
  const groups = getGroupUrls();
  if (!groups.length) {
    logger.warn('No Facebook group IDs configured. Skipping scrape.');
    await logSystemEvent('scrape', 'Skipped scrape run because GROUP_IDS is empty');
    return;
  }

  const { browser, context } = await createFacebookContext();

  try {
    const page = await context.newPage();

    for (const groupUrl of groups) {
      try {
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
        await humanDelay();
        logger.info(`Scraping group ${groupUrl}`);
        await logSystemEvent('scrape', `Scraping started for ${groupUrl}`);

        for (let i = 0; i < 5; i++) {
          await page.evaluate('window.scrollBy(0, 800)');
          await humanDelay();
        }

        const posts = await extractPosts(page);
        let stored = 0;

        for (const post of posts) {
          await prisma.postRaw.upsert({
            where: { fbPostId: post.fbPostId },
            update: {
              text: post.text,
              authorName: post.authorName,
              authorLink: post.authorLink,
            },
            create: {
              fbPostId: post.fbPostId,
              groupId: groupUrl,
              text: post.text,
              authorName: post.authorName,
              authorLink: post.authorLink,
            },
          });
          stored += 1;
        }

        await logSystemEvent('scrape', `Captured ${stored} posts from ${groupUrl}`);
        await humanDelay();
      } catch (error) {
        logger.error(`Failed to scrape ${groupUrl}: ${error}`);
        await logSystemEvent('error', `Failed to scrape ${groupUrl}: ${(error as Error).message}`);
      }
    }
  } finally {
    await saveCookies(context);
    await browser.close();
  }
};
