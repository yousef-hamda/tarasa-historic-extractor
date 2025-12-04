import logger from '../utils/logger';
import { humanDelay } from '../utils/delays';
import { extractPosts } from './extractors';
import prisma from '../database/prisma';
import { createFacebookContext, saveCookies } from '../facebook/session';
import { logSystemEvent } from '../utils/systemLog';
import { callPlaywrightWithRetry } from '../utils/playwrightRetry';

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

  const { context } = await createFacebookContext();

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(90000); // 90 seconds timeout

    for (const groupUrl of groups) {
      try {
        await callPlaywrightWithRetry(() =>
          page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 90000 })
        );
        logger.info(`Scraping group ${groupUrl}`);
        await logSystemEvent('scrape', `Scraping started for ${groupUrl}`);

        // Wait a bit for initial content
        await humanDelay(3000, 5000);

        // Scroll gradually to load more posts
        for (let i = 0; i < 5; i++) {
          try {
            await page.evaluate('window.scrollBy(0, 800)');
            await humanDelay(2000, 4000);
          } catch (scrollError) {
            logger.warn(`Scroll attempt ${i + 1} failed, continuing...`);
          }
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
    await context.close();
  }
};