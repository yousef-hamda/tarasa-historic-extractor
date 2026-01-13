/**
 * Playwright-based Facebook Group Scraper
 *
 * This module handles scraping private Facebook groups that require authentication.
 * It uses Playwright with saved cookies to access group content.
 *
 * Used as a fallback when Apify cannot access private groups.
 *
 * HEADLESS MODE: Browser runs in background by default.
 */

import { Browser, BrowserContext } from 'playwright';
import logger from '../utils/logger';
import { humanDelay } from '../utils/delays';
import { extractPosts } from './extractors';
import { createFacebookContext, saveCookies, getCookieHealth } from '../facebook/session';
import { TIMEOUTS } from '../config/constants';
import { NormalizedPost } from './apifyScraper';

// Maximum retries for browser operations
const MAX_BROWSER_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

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
 * Safely close browser with error handling
 */
const safeCloseBrowser = async (browser: Browser | BrowserContext | null): Promise<void> => {
  if (!browser) return;
  try {
    await browser.close();
    logger.debug('[Playwright] Browser closed successfully');
  } catch (closeError) {
    logger.warn(`[Playwright] Browser close warning: ${(closeError as Error).message}`);
  }
};

/**
 * Wait helper with timeout
 */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

  // Retry loop for browser operations
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_BROWSER_RETRIES; attempt++) {
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;

    try {
      logger.info(`[Playwright] Browser launch attempt ${attempt}/${MAX_BROWSER_RETRIES}`);
      const ctx = await createFacebookContext();
      browser = ctx.browser;
      context = ctx.context;

      const page = await context.newPage();
      page.setDefaultTimeout(TIMEOUTS.PAGE_DEFAULT);

      // Navigate to group with error handling
      try {
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUTS.NAVIGATION });
        logger.info(`[Playwright] Navigated to ${groupUrl}`);
      } catch (navError) {
        throw new Error(`Navigation failed: ${(navError as Error).message}`);
      }

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
          await saveCookies(context);
          await safeCloseBrowser(browser);
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

      // Wait for feed to appear
      logger.info('[Playwright] Waiting for feed container...');
      try {
        await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
        logger.info('[Playwright] Feed container found');
      } catch {
        logger.warn('[Playwright] Feed container not found, continuing anyway...');
      }

      // Dismiss any popups or overlays
      try {
        const closeButtons = await page.$$('[aria-label="Close"], [aria-label*="close"], button:has-text("Not now")');
        for (const btn of closeButtons.slice(0, 2)) {
          await btn.click().catch(() => {});
          await humanDelay(500, 1000);
        }
      } catch {
        // No popups to dismiss
      }

      // Scroll aggressively to load posts
      logger.info('[Playwright] Scrolling to load posts...');
      const scrollIterations = 8; // More scrolls to load more content
      for (let i = 0; i < scrollIterations; i++) {
        await page.evaluate('window.scrollBy(0, 1000)');
        await humanDelay(1000, 1500);

        // Check how many articles we have loaded
        const articleCount = await page.evaluate(() =>
          document.querySelectorAll('div[role="article"]').length
        );

        if (i % 2 === 0) {
          logger.info(`[Playwright] Scroll ${i + 1}/${scrollIterations}, articles loaded: ${articleCount}`);
        }

        // If we have enough articles, we can stop scrolling
        if (articleCount >= 20) {
          logger.info('[Playwright] Sufficient articles loaded, stopping scroll');
          break;
        }
      }

      // Wait for content to settle
      await humanDelay(2000, 3000);

      // Extract posts
      let posts = await extractPosts(page);
      logger.info(`[Playwright] First extraction: ${posts.length} posts`);

      // If few posts found, try scrolling more and re-extracting
      if (posts.length < 5) {
        logger.info('[Playwright] Few posts found, scrolling more...');
        for (let i = 0; i < 4; i++) {
          await page.evaluate('window.scrollBy(0, 1500)');
          await humanDelay(1500, 2000);
        }
        await humanDelay(2000, 3000);
        posts = await extractPosts(page);
        logger.info(`[Playwright] Second extraction: ${posts.length} posts`);
      }

      logger.info(`[Playwright] Extracted ${posts.length} posts from group ${groupId}`);

      // Convert to NormalizedPost format
      const normalizedPosts: NormalizedPost[] = posts.map(post => ({
        fbPostId: post.fbPostId,
        groupId: groupId,
        authorName: post.authorName || null,
        authorLink: post.authorLink || null,
        authorPhoto: null, // Profile photos not extracted by Playwright scraper
        text: post.text,
      }));

      // Save cookies (if context is still valid) and close browser on success
      try {
        if (context) {
          await saveCookies(context);
        }
      } catch (cookieError) {
        logger.warn(`[Playwright] Could not save cookies: ${(cookieError as Error).message}`);
      }
      await safeCloseBrowser(browser);

      return normalizedPosts;

    } catch (error) {
      lastError = error as Error;
      logger.error(`[Playwright] Attempt ${attempt} failed: ${lastError.message}`);

      // Try to save cookies before closing (they may still be valid)
      try {
        if (context) {
          await saveCookies(context);
        }
      } catch {
        // Cookies couldn't be saved, that's okay
      }

      // Clean up browser on error
      await safeCloseBrowser(browser);

      // Wait before retrying
      if (attempt < MAX_BROWSER_RETRIES) {
        logger.info(`[Playwright] Waiting ${RETRY_DELAY_MS}ms before retry...`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  // All retries exhausted
  logger.error(`[Playwright] All ${MAX_BROWSER_RETRIES} attempts failed for group ${groupId}`);
  if (lastError) {
    throw lastError;
  }
  return [];
};
