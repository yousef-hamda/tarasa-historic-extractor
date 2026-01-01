/**
 * Playwright-based Facebook Group Scraper
 *
 * This module handles scraping private Facebook groups that require authentication.
 * It uses Playwright with saved cookies to access group content.
 *
 * Used as a fallback when Apify cannot access private groups.
 */

import logger from '../utils/logger';
import { humanDelay } from '../utils/delays';
import { extractPosts } from './extractors';
import { createFacebookContext, saveCookies, getCookieHealth } from '../facebook/session';
import { TIMEOUTS } from '../config/constants';
import { NormalizedPost } from './apifyScraper';

/**
 * Check if we have a valid Facebook session before attempting to scrape
 */
export const hasValidFacebookSession = async (): Promise<boolean> => {
  const health = await getCookieHealth();
  if (!health.hasSession) {
    logger.warn('[Playwright] No valid Facebook session found. Run: npx ts-node src/scripts/facebook-login.ts');
    return false;
  }
  logger.info(`[Playwright] Valid session found for user: ${health.userId}`);
  return true;
};

/**
 * Scrape a single Facebook group using Playwright
 *
 * @param groupId - The Facebook group ID to scrape
 * @returns Array of normalized posts
 */
export const scrapeGroupWithPlaywright = async (groupId: string): Promise<NormalizedPost[]> => {
  const groupUrl = `https://www.facebook.com/groups/${groupId}`;
  logger.info(`[Playwright] Starting scrape for group ${groupId}`);

  // Pre-check: verify we have a valid session
  const hasSession = await hasValidFacebookSession();
  if (!hasSession) {
    logger.error('[Playwright] Cannot scrape without valid Facebook session');
    logger.error('[Playwright] Please run: npx ts-node src/scripts/facebook-login.ts');
    return [];
  }

  const { browser, context } = await createFacebookContext();

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.PAGE_DEFAULT);

    // Navigate to group
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });
    logger.info(`[Playwright] Navigated to ${groupUrl}`);

    // Check if we need to join the group
    await humanDelay(3000, 5000);
    const needsToJoin = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
      return buttons.some((el) => el.textContent?.includes('Join group'));
    });

    if (needsToJoin) {
      logger.info('[Playwright] Not a member of this group. Attempting to join...');
      try {
        await page.click('div[role="button"]:has-text("Join group")');
        await humanDelay(3000, 5000);
        logger.info('[Playwright] Join request submitted');
        await page.reload({ waitUntil: 'domcontentloaded' });
        await humanDelay(5000, 7000);
      } catch (joinError) {
        logger.warn(`[Playwright] Could not auto-join group: ${joinError}`);
        return [];
      }
    }

    // Click on Discussion tab if visible
    try {
      const discussionTab = await page.$('a:has-text("Discussion"), span:has-text("Discussion")');
      if (discussionTab) {
        await discussionTab.click();
        logger.info('[Playwright] Clicked Discussion tab');
        await humanDelay(3000, 5000);
      }
    } catch (tabError) {
      logger.debug(`[Playwright] Discussion tab click skipped: ${(tabError as Error).message}`);
    }

    // Scroll down to load feed content
    logger.info('[Playwright] Scrolling to load feed content...');
    for (let i = 0; i < 3; i++) {
      await page.evaluate('window.scrollBy(0, 600)');
      await humanDelay(1500, 2500);
    }

    // Wait for feed content to load
    logger.info('[Playwright] Waiting for feed content to load...');
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: TIMEOUTS.FEED_LOAD });
      logger.info('[Playwright] Feed container found');

      // Wait for actual content (not just loading state)
      await page.waitForFunction(
        () => {
          const articles = document.querySelectorAll('div[role="article"]');
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
      logger.info('[Playwright] Feed content loaded successfully');
    } catch (waitError) {
      logger.warn(`[Playwright] Feed loading issue: ${waitError}. Continuing anyway...`);
    }

    // Extra wait for lazy-loading
    await humanDelay(3000, 5000);

    // Scroll to load more posts
    for (let i = 0; i < 5; i++) {
      try {
        await page.evaluate('window.scrollBy(0, 800)');
        await humanDelay(2000, 3000);
      } catch (scrollError) {
        logger.warn(`[Playwright] Scroll attempt ${i + 1} failed`);
      }
    }

    // Wait after scrolling
    await humanDelay(2000, 3000);

    // Extract posts
    let posts = await extractPosts(page);

    // Retry if nothing found
    if (!posts.length) {
      logger.warn('[Playwright] No posts on first pass. Retrying...');
      for (let i = 0; i < 2; i++) {
        await page.evaluate('window.scrollBy(0, 1200)');
        await humanDelay(2000, 3000);
      }
      await humanDelay(2000, 3000);
      posts = await extractPosts(page);
    }

    logger.info(`[Playwright] Extracted ${posts.length} posts from group ${groupId}`);

    // Convert to NormalizedPost format
    const normalizedPosts: NormalizedPost[] = posts.map(post => ({
      fbPostId: post.fbPostId,
      groupId: groupId,
      authorName: post.authorName || null,
      authorLink: post.authorLink || null,
      text: post.text,
    }));

    return normalizedPosts;

  } finally {
    await saveCookies(context);
    await browser.close();
  }
};
