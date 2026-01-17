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
import {
  setupPostInterception,
  expandAllSeeMoreButtons,
  clearInterceptedCache,
} from './fullTextExtractor';

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

      // ENHANCED: Setup GraphQL interception to capture full post text
      // This intercepts Facebook's API responses which contain the complete post content
      logger.info('[Playwright] Setting up network interception for full text capture...');
      try {
        clearInterceptedCache(); // Clear any previous cache
        await setupPostInterception(page);
      } catch (interceptError) {
        logger.warn(`[Playwright] Could not setup interception: ${(interceptError as Error).message}`);
      }

      // Navigate to group with error handling
      try {
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        logger.info(`[Playwright] Navigated to ${groupUrl}`);
      } catch (navError) {
        throw new Error(`Navigation failed: ${(navError as Error).message}`);
      }

      // Check for "Content isn't available" error (group deleted, restricted, or not accessible)
      const contentNotAvailable = await page.evaluate(() => {
        const pageText = document.body.innerText || '';
        return pageText.includes("Content isn't available") ||
               pageText.includes('Content is not available') ||
               pageText.includes('This content is no longer available') ||
               pageText.includes('Sorry, this content isn');
      });

      if (contentNotAvailable) {
        logger.error(`[Playwright] Group ${groupId} shows "Content isn't available" - group may be deleted or restricted`);
        throw new Error('Content isn\'t available - group may be deleted, restricted, or you are not a member');
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

      // Dismiss popups and dialogs FIRST before any content checks
      logger.info('[Playwright] Dismissing any popups/dialogs...');
      try {
        // Look for close buttons on dialogs
        const closeSelectors = [
          '[aria-label="Close"]',
          'button:has-text("Not now")',
          'button:has-text("Close")',
          '[aria-label="Dismiss"]',
          'div[role="dialog"] [aria-label="Close"]'
        ];
        for (const selector of closeSelectors) {
          const buttons = await page.$$(selector);
          for (const btn of buttons.slice(0, 2)) {
            try {
              await btn.click();
              await sleep(500);
              logger.info(`[Playwright] Dismissed popup with ${selector}`);
            } catch {}
          }
        }
      } catch (e) {
        logger.debug(`[Playwright] Popup dismissal: ${(e as Error).message}`);
      }

      // Try to navigate to Discussion tab to ensure we see the full feed
      try {
        const discussionTab = await page.$('a:has-text("Discussion")');
        if (discussionTab) {
          await discussionTab.click();
          await sleep(3000);  // Longer wait for content to load
          logger.info('[Playwright] Clicked Discussion tab');
        }
      } catch (e) {
        logger.debug(`[Playwright] Discussion tab: ${(e as Error).message}`);
      }

      // Wait for feed content to load after navigation
      await page.waitForTimeout(2000);

      // Scroll to top to ensure we're at the start of the feed
      await page.evaluate('window.scrollTo(0, 0)');
      await sleep(1000);

      // NOW wait for actual content to load after Discussion tab click
      logger.info('[Playwright] Waiting for post content to load...');
      const maxWaitAttempts = 15;
      for (let attempt = 0; attempt < maxWaitAttempts; attempt++) {
        const contentCheck = await page.evaluate(() => {
          const feed = document.querySelector('div[role="feed"]');
          if (!feed) return { hasContent: false };

          const dirAutoDivs = document.querySelectorAll('div[dir="auto"]');
          let substantialCount = 0;
          for (const div of dirAutoDivs) {
            const text = (div as HTMLElement).innerText || '';
            if (text.length > 100 && !text.includes('Loading')) {
              substantialCount++;
            }
          }

          return {
            hasContent: substantialCount >= 2,
            substantialCount
          };
        });

        if (contentCheck.hasContent) {
          logger.info(`[Playwright] Found ${contentCheck.substantialCount} substantial text elements`);
          break;
        }

        await page.evaluate('window.scrollBy(0, 300)');
        await sleep(1000);
      }

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

      // Extract group name AND group type (public/private) from page
      try {
        const groupInfo = await page.evaluate(() => {
          let groupName: string | null = null;
          let groupType: 'public' | 'private' | 'unknown' = 'unknown';

          // Extract group name
          const nameSelectors = [
            'h1 a[href*="/groups/"]',
            'h1 span',
            'div[role="main"] h1',
            'a[aria-label][href*="/groups/"]',
          ];
          for (const selector of nameSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent) {
              const name = el.textContent.trim();
              if (name.length > 2 && name.length < 100) {
                groupName = name;
                break;
              }
            }
          }
          // Fallback to page title
          if (!groupName) {
            const title = document.title;
            if (title && !title.includes('Facebook')) {
              groupName = title.split('|')[0].trim();
            }
          }

          // DETECT GROUP TYPE from page content
          // Look for "Public group" or "Private group" text indicators
          const pageText = document.body.innerText || '';

          // Check for explicit public/private indicators
          if (pageText.includes('Public group') ||
              pageText.includes('Public ·') ||
              pageText.includes('Anyone can see who') ||
              pageText.includes('Anyone can find this group')) {
            groupType = 'public';
          } else if (pageText.includes('Private group') ||
                     pageText.includes('Private ·') ||
                     pageText.includes('Only members can see who') ||
                     pageText.includes('Only members can find this group')) {
            groupType = 'private';
          }

          // Also check for specific elements that indicate privacy
          const privacyElements = document.querySelectorAll('[aria-label*="Public"], [aria-label*="Private"]');
          privacyElements.forEach(el => {
            const label = el.getAttribute('aria-label') || '';
            if (label.includes('Public')) groupType = 'public';
            if (label.includes('Private')) groupType = 'private';
          });

          return { groupName, groupType };
        });

        if (groupInfo.groupName) {
          logger.info(`[Playwright] Group name: ${groupInfo.groupName}`);
        }
        logger.info(`[Playwright] Detected group type: ${groupInfo.groupType}`);

        // Update group info in database with ACTUAL group type from page
        const { updateGroupCache } = await import('./groupDetector');
        await updateGroupCache(groupId, {
          groupName: groupInfo.groupName,
          groupType: groupInfo.groupType as 'public' | 'private' | 'unknown',
          accessMethod: 'playwright',
          isAccessible: true,
          errorMessage: null // Clear any previous errors
        });
      } catch (e) {
        logger.debug(`[Playwright] Could not extract group info: ${(e as Error).message}`);
      }

      // Scroll to load posts - more scrolling for better coverage
      logger.info('[Playwright] Scrolling to load posts...');
      const scrollIterations = 10;  // Increased from 6
      for (let i = 0; i < scrollIterations; i++) {
        await page.evaluate('window.scrollBy(0, 1500)');
        await sleep(1000);  // Slightly longer wait for content to load

        // Check content every few scrolls
        if (i % 3 === 0) {
          const contentCheck = await page.evaluate(() => {
            // Count text elements with substantial content (our extraction target)
            const dirAutoDivs = document.querySelectorAll('div[dir="auto"]');
            let substantialText = 0;
            for (const div of dirAutoDivs) {
              const text = (div as HTMLElement).innerText || '';
              if (text.length > 100) substantialText++;
            }
            return { substantialText };
          });
          logger.info(`[Playwright] Scroll ${i + 1}/${scrollIterations}, text elements: ${contentCheck.substantialText}`);

          // If we have enough content, stop scrolling
          if (contentCheck.substantialText >= 20) {
            logger.info('[Playwright] Sufficient content loaded, stopping scroll');
            break;
          }
        }
      }

      // OPTIMIZED: Reduced settle time from 2-3s to 1s
      await sleep(1000);

      // ENHANCED: Expand all "See more" buttons BEFORE extraction
      // This is critical for getting full text from truncated posts
      logger.info('[Playwright] Expanding all "See more" buttons for full text...');
      try {
        const expandedCount = await expandAllSeeMoreButtons(page);
        if (expandedCount > 0) {
          logger.info(`[Playwright] Successfully expanded ${expandedCount} "See more" buttons`);
          // Wait for content to fully render
          await sleep(1000);
        }
      } catch (expandError) {
        logger.warn(`[Playwright] "See more" expansion error: ${(expandError as Error).message}`);
      }

      // Extract posts (now with enhanced full-text support)
      let posts = await extractPosts(page, context);
      logger.info(`[Playwright] First extraction: ${posts.length} posts`);

      // If few posts found, quick extra scroll
      if (posts.length < 3) {
        logger.info('[Playwright] Few posts, quick additional scroll...');
        for (let i = 0; i < 3; i++) {
          await page.evaluate('window.scrollBy(0, 2000)');
          await sleep(600);
        }
        await sleep(800);
        // Expand "See more" again after scrolling
        await expandAllSeeMoreButtons(page).catch(() => {});
        await sleep(500);
        posts = await extractPosts(page, context);
        logger.info(`[Playwright] Second extraction: ${posts.length} posts`);
      }

      logger.info(`[Playwright] Extracted ${posts.length} posts from group ${groupId}`);

      // Convert to NormalizedPost format
      const normalizedPosts: NormalizedPost[] = posts.map(post => {
        // Construct post URL if not extracted, using groupId and fbPostId
        let postUrl = post.postUrl || null;
        if (!postUrl && post.fbPostId && !post.fbPostId.startsWith('hash_')) {
          postUrl = `https://www.facebook.com/groups/${groupId}/posts/${post.fbPostId}`;
        }

        return {
          fbPostId: post.fbPostId,
          groupId: groupId,
          authorName: post.authorName || null,
          authorLink: post.authorLink || null,
          authorPhoto: post.authorPhoto || null,
          text: post.text,
          postUrl,
        };
      });

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
