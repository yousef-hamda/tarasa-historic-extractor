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
import { extractPosts } from './extractors';
import { createFacebookContext, saveCookies, getCookieHealth } from '../facebook/session';
import { NormalizedPost } from './apifyScraper';
import { browserPool } from '../utils/browserPool';

// Maximum retries for browser operations
const MAX_BROWSER_RETRIES = 2;

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
 * OPTIMIZED for faster performance with reduced wait times
 *
 * @param groupId - The Facebook group ID to scrape
 * @returns Array of normalized posts
 */
export const scrapeGroupWithPlaywright = async (groupId: string): Promise<NormalizedPost[]> => {
  const groupUrl = `https://www.facebook.com/groups/${groupId}`;
  logger.info(`[Playwright] Starting scrape for group ${groupId}`);

  // Use browser pool to limit concurrent instances
  return browserPool.execute(async () => {
    return scrapeGroupInternal(groupId, groupUrl);
  });
};

/**
 * Internal scraping implementation (called within browser pool)
 */
const scrapeGroupInternal = async (groupId: string, groupUrl: string): Promise<NormalizedPost[]> => {

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
      // OPTIMIZED: Use shorter default timeout (15s instead of 90s)
      page.setDefaultTimeout(15000);

      // Navigate to group with error handling
      try {
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        logger.info(`[Playwright] Navigated to ${groupUrl}`);
      } catch (navError) {
        throw new Error(`Navigation failed: ${(navError as Error).message}`);
      }

      // Wait for feed to appear FIRST (most important element)
      logger.info('[Playwright] Waiting for feed container...');
      try {
        await page.waitForSelector('div[role="feed"]', { timeout: 20000 });
        logger.info('[Playwright] Feed container found');
      } catch {
        // Try waiting for any article as fallback
        try {
          await page.waitForSelector('div[role="article"]', { timeout: 10000 });
          logger.info('[Playwright] Article found (feed selector failed)');
        } catch {
          logger.warn('[Playwright] No feed or articles found, continuing anyway...');
        }
      }

      // Quick popup dismissal (non-blocking, don't wait)
      page.$$('[aria-label="Close"], button:has-text("Not now")').then(async (buttons) => {
        for (const btn of buttons.slice(0, 2)) {
          btn.click().catch((e) => logger.debug(`[Playwright] Popup dismiss click failed: ${e.message}`));
        }
      }).catch((e) => logger.debug(`[Playwright] Popup dismissal skipped: ${e.message}`));

      // Check if we need to join the group (quick check)
      const needsToJoin = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('div[role="button"], span[role="button"]'));
        return buttons.some((el) => el.textContent?.includes('Join group'));
      });

      if (needsToJoin) {
        logger.info('[Playwright] Not a member of this group. Attempting to join...');
        try {
          await page.click('div[role="button"]:has-text("Join group")', { timeout: 5000 });
          await sleep(2000);
          logger.info('[Playwright] Join request submitted');
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
          await sleep(3000);
        } catch (joinError) {
          logger.warn(`[Playwright] Could not auto-join group: ${joinError}`);
          await saveCookies(context);
          await safeCloseBrowser(browser);
          return [];
        }
      }

      // Extract group name and update cache
      try {
        const groupName = await page.evaluate(() => {
          // Try multiple selectors for group name
          const selectors = [
            'h1 a[href*="/groups/"]',
            'h1 span',
            'div[role="main"] h1',
            'a[aria-label][href*="/groups/"]',
          ];
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
              const name = el.textContent.trim();
              if (name.length > 2 && name.length < 100) {
                return name;
              }
            }
          }
          // Fallback to page title
          const title = document.title;
          if (title && !title.includes('Facebook')) {
            return title.split('|')[0].trim();
          }
          return null;
        });

        if (groupName) {
          logger.info(`[Playwright] Group name: ${groupName}`);
          // Update group info in database
          const { updateGroupCache } = await import('./groupDetector');
          await updateGroupCache(groupId, { groupName });
        }
      } catch (e) {
        logger.debug(`[Playwright] Could not extract group name: ${(e as Error).message}`);
      }

      // OPTIMIZED: Faster scrolling with larger increments and shorter waits
      logger.info('[Playwright] Scrolling to load posts...');
      const scrollIterations = 6;
      for (let i = 0; i < scrollIterations; i++) {
        await page.evaluate('window.scrollBy(0, 1500)');
        await sleep(800); // Fixed short delay instead of random

        // Check article count every other scroll
        if (i % 2 === 0) {
          const articleCount = await page.evaluate(() =>
            document.querySelectorAll('div[role="article"]').length
          );
          logger.info(`[Playwright] Scroll ${i + 1}/${scrollIterations}, articles: ${articleCount}`);

          // If we have enough articles, stop scrolling
          if (articleCount >= 15) {
            logger.info('[Playwright] Sufficient articles loaded, stopping scroll');
            break;
          }
        }
      }

      // OPTIMIZED: Reduced settle time from 2-3s to 1s
      await sleep(1000);

      // Extract posts
      let posts = await extractPosts(page);
      logger.info(`[Playwright] First extraction: ${posts.length} posts`);

      // If few posts found, quick extra scroll
      if (posts.length < 3) {
        logger.info('[Playwright] Few posts, quick additional scroll...');
        for (let i = 0; i < 3; i++) {
          await page.evaluate('window.scrollBy(0, 2000)');
          await sleep(600);
        }
        await sleep(800);
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
        authorPhoto: post.authorPhoto || null,
        text: post.text,
      }));

      // Save cookies and close browser
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

      // Try to save cookies before closing
      try {
        if (context) {
          await saveCookies(context);
        }
      } catch {
        // Cookies couldn't be saved, that's okay
      }

      // Clean up browser on error
      await safeCloseBrowser(browser);

      // OPTIMIZED: Reduced retry delay from 5s to 3s
      if (attempt < MAX_BROWSER_RETRIES) {
        logger.info('[Playwright] Waiting 3s before retry...');
        await sleep(3000);
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
