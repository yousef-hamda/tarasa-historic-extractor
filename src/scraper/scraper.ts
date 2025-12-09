import logger from '../utils/logger';
import { humanDelay } from '../utils/delays';
import { extractPosts } from './extractors';
import prisma from '../database/prisma';
import { createFacebookContext, saveCookies } from '../facebook/session';
import { logSystemEvent } from '../utils/systemLog';
import { TIMEOUTS } from '../config/constants';
import path from 'path';

const getGroupUrls = (): string[] => {
  const ids = (process.env.GROUP_IDS ?? '')
    .split(',')
    .map((id: string) => id.trim())
    .filter((id: string): id is string => Boolean(id));

  return ids.map((id: string) => `https://www.facebook.com/groups/${id}`);
};

export const scrapeGroups = async (): Promise<void> => {
  const groups = getGroupUrls();
  if (!groups.length) {
    logger.warn('No Facebook group IDs configured. Skipping scrape.');
    await logSystemEvent('scrape', 'Skipped scrape run because GROUP_IDS is empty');
    return;
  }

  const { browser, context } = await createFacebookContext();

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.PAGE_DEFAULT);

    for (const groupUrl of groups) {
      try {
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });
        logger.info(`Scraping group ${groupUrl}`);
        await logSystemEvent('scrape', `Scraping started for ${groupUrl}`);

        // Check if we need to join the group first
        await humanDelay(3000, 5000);
        const needsToJoin = await page.evaluate(() => {
          // Find all role="button" elements and check if any contains "Join group"
          const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
          return buttons.some((el) => el.textContent?.includes('Join group'));
        });

        if (needsToJoin) {
          logger.info('Not a member of this group. Attempting to join...');
          try {
            // Try to click the Join group button using Playwright selector
            await page.click('div[role="button"]:has-text("Join group")');
            await humanDelay(3000, 5000);
            logger.info('Join request submitted. Waiting for group access...');
            await logSystemEvent('scrape', `Join request submitted for group ${groupUrl}`);

            // Reload the page to check if we're now a member
            await page.reload({ waitUntil: 'domcontentloaded' });
            await humanDelay(5000, 7000);
          } catch (joinError) {
            logger.warn(`Could not auto-join group: ${joinError}. Group may require approval.`);
            await logSystemEvent('scrape', `Cannot scrape ${groupUrl} - not a member and cannot auto-join`);
            continue; // Skip this group
          }
        }

        // Click on Discussion tab to ensure we're viewing posts
        try {
          const discussionTab = await page.$('a:has-text("Discussion"), span:has-text("Discussion")');
          if (discussionTab) {
            await discussionTab.click();
            logger.info('Clicked Discussion tab');
            await humanDelay(3000, 5000);
          }
        } catch (tabError) {
          // Tab might not exist, already active, or page structure changed
          logger.debug(`Discussion tab click skipped: ${(tabError as Error).message}`);
        }

        // Scroll down to load feed content (past the header/hero area)
        logger.info('Scrolling to load feed content...');
        for (let i = 0; i < 3; i++) {
          await page.evaluate('window.scrollBy(0, 600)');
          await humanDelay(1500, 2500);
        }

        // Wait for actual content to load (not just skeleton placeholders)
        logger.info('Waiting for feed content to load...');
        try {
          // Wait for feed role and then for actual post content (not loading state)
          await page.waitForSelector('div[role="feed"]', { timeout: TIMEOUTS.FEED_LOAD });
          logger.info('Feed container found, waiting for posts...');

          // Wait for actual content (posts have more than just loading state)
          await page.waitForFunction(
            () => {
              const articles = document.querySelectorAll('div[role="article"]');
              // Check that at least one article has actual text content (not just loading)
              for (const article of articles) {
                if (article.textContent && article.textContent.length > 100 &&
                    !article.querySelector('[aria-label="Loading..."]')) {
                  return true;
                }
              }
              return false;
            },
            { timeout: TIMEOUTS.FEED_LOAD }
          );
          logger.info('Feed content loaded successfully');
        } catch (waitError) {
          logger.warn(`Feed loading issue: ${waitError}. Continuing anyway...`);
        }

        // Extra wait for any lazy-loading
        await humanDelay(3000, 5000);

        // Scroll gradually to load more posts
        for (let i = 0; i < 5; i++) {
          try {
            await page.evaluate('window.scrollBy(0, 800)');
            await humanDelay(2000, 3000);
          } catch (scrollError) {
            logger.warn(`Scroll attempt ${i + 1} failed, continuing...`);
          }
        }

        // One more wait after scrolling for content to render
        await humanDelay(2000, 3000);

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

/**
 * Debug function to take a screenshot and get page info
 */
export const debugScrape = async () => {
  const groups = getGroupUrls();
  if (!groups.length) {
    return { error: 'No groups configured' };
  }

  const { browser, context } = await createFacebookContext();

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.DEBUG);

    const groupUrl = groups[0];
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.DEBUG });
    logger.info(`Debug: Navigated to ${groupUrl}`);

    // Wait a bit for initial content
    await humanDelay(5000, 7000);

    // Click Discussion tab if visible
    try {
      const discussionTab = await page.$('a:has-text("Discussion"), span:has-text("Discussion")');
      if (discussionTab) {
        await discussionTab.click();
        logger.info('Debug: Clicked Discussion tab');
        await humanDelay(3000, 5000);
      }
    } catch (tabError) {
      // Tab might not exist or already active
      logger.debug(`Debug: Discussion tab click skipped: ${(tabError as Error).message}`);
    }

    // Scroll down to load feed
    for (let i = 0; i < 5; i++) {
      await page.evaluate('window.scrollBy(0, 600)');
      await humanDelay(1500, 2000);
    }

    // Wait for content
    await humanDelay(5000, 7000);

    // Take screenshot with timestamp to avoid overwriting
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.resolve(__dirname, `../config/debug-screenshot-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    logger.info(`Debug: Screenshot saved to ${screenshotPath}`);

    // Get page info - try multiple selectors
    const pageInfo = await page.evaluate(() => {
      const url = window.location.href;
      const title = document.title;
      const feedElement = document.querySelector('div[role="feed"]');
      const loginForm = document.querySelector('input[name="email"]');
      const groupTitle = document.querySelector('h1')?.textContent || '';

      // Try multiple post container selectors
      let articles = document.querySelectorAll('div[role="article"]');

      // If role="article" doesn't find posts with content, try feed children
      if (articles.length < 3) {
        const feedPosts = document.querySelectorAll('div[role="feed"] > div');
        if (feedPosts.length > articles.length) {
          articles = feedPosts;
        }
      }

      const articlesInfo = [];
      for (let i = 0; i < Math.min(articles.length, 10); i++) {
        const article = articles[i];
        const text = (article.textContent || '').trim();
        articlesInfo.push({
          textLength: text.length,
          hasLoading: !!article.querySelector('[aria-label="Loading..."]'),
          preview: text.substring(0, 150).replace(/\s+/g, ' '),
          hasImage: !!article.querySelector('img'),
          hasAuthor: !!article.querySelector('a[href*="/user/"], a[href*="/profile.php"]'),
        });
      }

      return {
        url,
        title,
        hasFeed: !!feedElement,
        articleCount: articles.length,
        articlesInfo,
        isLoginPage: !!loginForm,
        groupTitle,
      };
    });

    return {
      status: 'success',
      screenshotPath,
      pageInfo,
      message: 'Check the screenshot at the path above to see what the browser sees',
    };
  } finally {
    await saveCookies(context);
    await browser.close();
  }
};