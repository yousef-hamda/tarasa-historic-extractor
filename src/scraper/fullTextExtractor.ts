/**
 * Full Text Extractor for Facebook Posts
 *
 * This module provides multiple strategies to extract the complete text
 * from Facebook posts, solving the "See more" truncation problem.
 *
 * Strategies:
 * 1. GraphQL API Interception - Capture full text from network requests
 * 2. Enhanced "See More" Clicking - JavaScript-based button clicking
 * 3. DOM Deep Search - Find full text in hidden elements/data attributes
 * 4. Permalink Navigation - Navigate to individual post pages
 *
 * @module fullTextExtractor
 */

import { Page, ElementHandle, BrowserContext } from 'playwright';
import logger from '../utils/logger';

// Store for intercepted full text from GraphQL responses
interface InterceptedPost {
  postId: string;
  fullText: string;
  authorName?: string;
  timestamp?: number;
}

// Map to store intercepted post data keyed by partial text match
const interceptedPosts = new Map<string, InterceptedPost>();

/**
 * Setup GraphQL request interception to capture full post text
 * Facebook loads post content via GraphQL API - we can intercept it
 */
export const setupPostInterception = async (page: Page): Promise<void> => {
  logger.info('[FullText] Setting up GraphQL interception for full post text...');

  // Clear previous intercepted data
  interceptedPosts.clear();

  await page.route('**/api/graphql/**', async (route, request) => {
    // Let the request proceed
    const response = await route.fetch();

    try {
      const responseBody = await response.text();

      // Parse the response to extract post text
      // Facebook's GraphQL responses contain full post content
      const posts = extractPostsFromGraphQL(responseBody);

      for (const post of posts) {
        if (post.fullText && post.fullText.length > 50) {
          // Use first 50 chars as a key for matching
          const key = post.fullText.substring(0, 50).toLowerCase().trim();
          interceptedPosts.set(key, post);
          logger.debug(`[FullText] Intercepted post text: ${post.fullText.substring(0, 100)}...`);
        }
      }
    } catch (e) {
      // Ignore parsing errors - not all responses contain post data
    }

    // Continue with the original response
    await route.fulfill({ response });
  });

  logger.info('[FullText] GraphQL interception setup complete');
};

/**
 * Extract post content from Facebook's GraphQL response
 */
const extractPostsFromGraphQL = (responseText: string): InterceptedPost[] => {
  const posts: InterceptedPost[] = [];

  try {
    // Facebook returns multiple JSON objects, sometimes separated by newlines
    const jsonStrings = responseText.split('\n').filter(line => line.trim().startsWith('{'));

    for (const jsonStr of jsonStrings) {
      try {
        const data = JSON.parse(jsonStr);

        // Recursively search for post content in the response
        findPostContent(data, posts);
      } catch {
        // Skip invalid JSON
      }
    }
  } catch (e) {
    logger.debug(`[FullText] GraphQL parse error: ${(e as Error).message}`);
  }

  return posts;
};

/**
 * Recursively search for post content in GraphQL response
 */
const findPostContent = (obj: any, posts: InterceptedPost[], depth = 0): void => {
  if (depth > 20 || !obj || typeof obj !== 'object') return;

  // Look for message/text fields that contain post content
  const textFields = ['message', 'text', 'body', 'content', 'story'];

  for (const field of textFields) {
    if (obj[field] && typeof obj[field] === 'object' && obj[field].text) {
      const fullText = obj[field].text;
      if (typeof fullText === 'string' && fullText.length > 30) {
        posts.push({
          postId: obj.id || obj.post_id || obj.story_id || '',
          fullText: fullText,
          authorName: extractAuthorFromObj(obj),
        });
      }
    } else if (obj[field] && typeof obj[field] === 'string' && obj[field].length > 50) {
      posts.push({
        postId: obj.id || obj.post_id || '',
        fullText: obj[field],
        authorName: extractAuthorFromObj(obj),
      });
    }
  }

  // Also check for comet_sections which often contain post data
  if (obj.comet_sections?.content?.story?.message?.text) {
    posts.push({
      postId: obj.id || '',
      fullText: obj.comet_sections.content.story.message.text,
    });
  }

  // Recurse into arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      findPostContent(item, posts, depth + 1);
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === 'object') {
        findPostContent(obj[key], posts, depth + 1);
      }
    }
  }
};

/**
 * Extract author name from GraphQL object
 */
const extractAuthorFromObj = (obj: any): string | undefined => {
  if (obj.author?.name) return obj.author.name;
  if (obj.actor?.name) return obj.actor.name;
  if (obj.owning_profile?.name) return obj.owning_profile.name;
  return undefined;
};

/**
 * Get intercepted full text that matches truncated text
 */
export const getInterceptedFullText = (truncatedText: string): string | null => {
  if (!truncatedText || truncatedText.length < 30) return null;

  // Try to match by the beginning of the text
  const searchKey = truncatedText.substring(0, 50).toLowerCase().trim();

  for (const [key, post] of interceptedPosts) {
    if (key.startsWith(searchKey.substring(0, 30)) || searchKey.startsWith(key.substring(0, 30))) {
      logger.debug(`[FullText] Found intercepted full text match`);
      return post.fullText;
    }
  }

  return null;
};

/**
 * Click all "See more" buttons in a container using JavaScript injection
 * This is more reliable than Playwright's click() as it simulates native events
 *
 * IMPORTANT: This function carefully avoids clicking on:
 * - Links (a tags with href) - these navigate away
 * - Hashtag links (#something)
 * - External links
 * - Comments/likes/share buttons
 */
export const expandAllSeeMoreButtons = async (page: Page, container?: ElementHandle<Element>): Promise<number> => {
  logger.info('[FullText] Expanding all "See more" buttons...');

  const expandedCount = await page.evaluate((containerSelector) => {
    let expanded = 0;

    // "See more" patterns - ONLY exact or near-exact matches
    // Avoid partial matches like "more" which could match hashtags
    const seeMorePatterns = [
      'see more',
      '...more',
      '… more',
      'ראה עוד',      // Hebrew "See more"
      'עוד...',       // Hebrew "more..."
      'عرض المزيد',   // Arabic "See more"
      'ver más',      // Spanish
      'voir plus',    // French
      'mehr ansehen', // German
    ];

    // Elements/text to NEVER click on (avoid navigation)
    const neverClickPatterns = [
      '#', // hashtags
      'http', // links
      'comment', // comment buttons
      'like', // like buttons
      'share', // share buttons
      'reply', // reply buttons
      'reaction', // reaction buttons
    ];

    // Check if an element is safe to click (not a navigation link)
    const isSafeToClick = (el: Element): boolean => {
      // Never click on actual links with href
      if (el.tagName === 'A') {
        const href = el.getAttribute('href');
        if (href && href !== '#' && href !== 'javascript:void(0)') {
          return false; // It's a real link, don't click
        }
      }

      // Check if any parent is a navigation link
      const parentLink = el.closest('a[href]');
      if (parentLink) {
        const href = parentLink.getAttribute('href');
        if (href && !href.startsWith('javascript:')) {
          return false; // Parent is a real link
        }
      }

      // Check the text content for unsafe patterns
      const text = (el as HTMLElement).innerText?.toLowerCase() || '';
      for (const pattern of neverClickPatterns) {
        if (text.includes(pattern)) {
          return false;
        }
      }

      return true;
    };

    // Check if text matches "See more" pattern EXACTLY
    const isSeeMoreText = (text: string): boolean => {
      if (!text) return false;
      const lowerText = text.toLowerCase().trim();

      // Must be a short text (just "See more" or similar)
      if (lowerText.length > 30) return false;

      // Check for exact or near-exact matches
      for (const pattern of seeMorePatterns) {
        if (lowerText === pattern || lowerText.startsWith(pattern)) {
          return true;
        }
      }

      return false;
    };

    // Function to find and click "See more" elements SAFELY
    const clickSeeMore = (root: Element | Document): number => {
      let count = 0;
      const clickedElements = new Set<Element>();

      // Strategy 1: Find by role="button" with exact "See more" text
      const roleButtons = root.querySelectorAll('[role="button"]');
      for (const btn of roleButtons) {
        if (clickedElements.has(btn)) continue;

        const text = (btn as HTMLElement).innerText?.trim();

        // Must be short text that's exactly "See more"
        if (text && isSeeMoreText(text) && isSafeToClick(btn)) {
          try {
            (btn as HTMLElement).click();
            clickedElements.add(btn);
            count++;
          } catch {}
        }
      }

      // Strategy 2: Find span elements with exact "See more" text
      // (NOT div or a elements to avoid clicking on content or links)
      const spanElements = root.querySelectorAll('span');
      for (const el of spanElements) {
        if (clickedElements.has(el)) continue;

        const text = (el as HTMLElement).innerText?.trim();

        if (text && isSeeMoreText(text) && isSafeToClick(el)) {
          // Check if it looks clickable
          const style = window.getComputedStyle(el);
          const isClickable = style.cursor === 'pointer' ||
                             el.getAttribute('role') === 'button' ||
                             el.closest('[role="button"]');

          if (isClickable) {
            try {
              (el as HTMLElement).click();
              clickedElements.add(el);
              count++;
            } catch {}
          }
        }
      }

      return count;
    };

    // Click all "See more" buttons
    expanded = clickSeeMore(document);

    return expanded;
  }, container ? await container.evaluate(el => {
    // Get a unique selector for the container
    return null; // We'll operate on the whole page
  }) : null);

  // Wait for content to expand
  await page.waitForTimeout(800);

  // Try clicking again in case new "See more" buttons appeared
  const secondPass = await page.evaluate(() => {
    let count = 0;
    const seeMoreButtons = document.querySelectorAll('[role="button"]');
    for (const btn of seeMoreButtons) {
      const text = (btn as HTMLElement).innerText?.trim();
      if (text && (text.includes('See more') || text.includes('ראה עוד') || text.includes('عرض المزيد'))) {
        try {
          (btn as HTMLElement).click();
          count++;
        } catch {}
      }
    }
    return count;
  });

  if (secondPass > 0) {
    await page.waitForTimeout(500);
  }

  const totalExpanded = expandedCount + secondPass;
  logger.info(`[FullText] Expanded ${totalExpanded} "See more" buttons`);

  return totalExpanded;
};

/**
 * Extract full text from a post container by trying multiple methods
 */
export const extractFullTextFromContainer = async (
  page: Page,
  container: ElementHandle<Element>
): Promise<string> => {
  let fullText = '';

  // Method 1: Try to click "See more" within this container specifically
  try {
    const clicked = await container.evaluate((el) => {
      let clicked = 0;
      const seeMorePatterns = ['See more', 'ראה עוד', 'عرض المزيد', '...more'];

      // Find all clickable elements with "See more" text
      const allClickable = el.querySelectorAll('[role="button"], span, div, a');
      for (const elem of allClickable) {
        const text = (elem as HTMLElement).innerText?.trim();
        if (text && seeMorePatterns.some(p => text.toLowerCase().includes(p.toLowerCase()))) {
          try {
            (elem as HTMLElement).click();
            clicked++;
          } catch {}
        }
      }

      return clicked;
    });

    if (clicked > 0) {
      // Wait for expansion
      await page.waitForTimeout(600);
      logger.debug(`[FullText] Clicked ${clicked} "See more" in container`);
    }
  } catch (e) {
    logger.debug(`[FullText] Container click error: ${(e as Error).message}`);
  }

  // Method 2: Extract text from data-ad-preview element (Facebook stores full text here sometimes)
  try {
    fullText = await container.evaluate((el) => {
      // Try data-ad-preview first (contains full message)
      const adPreview = el.querySelector('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
      if (adPreview) {
        return (adPreview as HTMLElement).innerText?.trim() || '';
      }
      return '';
    });
  } catch {}

  // Method 3: Look for the text in all div[dir="auto"] elements and get the longest one
  if (!fullText || fullText.length < 50) {
    try {
      fullText = await container.evaluate((el) => {
        const textDivs = el.querySelectorAll('div[dir="auto"]');
        let longestText = '';

        for (const div of textDivs) {
          const text = (div as HTMLElement).innerText?.trim() || '';
          // Filter out UI elements
          if (text.length > longestText.length &&
              !text.match(/^(Like|Comment|Share|Reply|See more|See translation|Send)$/i) &&
              text.length > 30) {
            longestText = text;
          }
        }

        return longestText;
      });
    } catch {}
  }

  // Method 4: Look for hidden/collapsed content
  if (!fullText || fullText.length < 50) {
    try {
      fullText = await container.evaluate((el) => {
        // Look for elements that might contain hidden full text
        const selectors = [
          '[data-testid="post_message"]',
          '[data-ad-preview]',
          'div[class*="userContent"]',
          'div[class*="text_exposed_root"]',
        ];

        for (const selector of selectors) {
          const elem = el.querySelector(selector);
          if (elem) {
            const text = (elem as HTMLElement).innerText?.trim() || '';
            if (text.length > 50) return text;
          }
        }

        return '';
      });
    } catch {}
  }

  // Method 5: Get all text from the container and clean it
  if (!fullText || fullText.length < 50) {
    try {
      fullText = await container.evaluate((el) => {
        // Get all text content
        let text = (el as HTMLElement).innerText || '';

        // Remove common UI elements
        const uiPatterns = [
          /^Like$/gm, /^Comment$/gm, /^Share$/gm, /^Reply$/gm,
          /^\d+\s*(likes?|comments?|shares?)$/gim,
          /^See translation$/gm, /^See original$/gm,
          /^Write a comment/gm,
        ];

        for (const pattern of uiPatterns) {
          text = text.replace(pattern, '');
        }

        return text.trim();
      });
    } catch {}
  }

  return fullText;
};

/**
 * Navigate to a post's permalink to get the full text
 * This is the most reliable method but slower
 */
export const getFullTextFromPermalink = async (
  context: BrowserContext,
  postUrl: string
): Promise<string | null> => {
  if (!postUrl) return null;

  logger.info(`[FullText] Navigating to permalink: ${postUrl}`);

  let page: Page | null = null;

  try {
    page = await context.newPage();
    page.setDefaultTimeout(15000);

    await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // Click any "See more" on the full post page
    await expandAllSeeMoreButtons(page);

    // Extract the full text from the post page
    const fullText = await page.evaluate(() => {
      // On a single post page, the main content is usually in a specific location
      const selectors = [
        'div[data-ad-preview="message"]',
        'div[data-ad-comet-preview="message"]',
        'div[dir="auto"][style*="text-align"]',
        'div[class*="userContent"]',
      ];

      for (const selector of selectors) {
        const elem = document.querySelector(selector);
        if (elem) {
          const text = (elem as HTMLElement).innerText?.trim();
          if (text && text.length > 30) return text;
        }
      }

      // Fallback: get the longest text from dir="auto" divs
      const allDivs = document.querySelectorAll('div[dir="auto"]');
      let longestText = '';

      for (const div of allDivs) {
        const text = (div as HTMLElement).innerText?.trim() || '';
        if (text.length > longestText.length && text.length > 50) {
          longestText = text;
        }
      }

      return longestText;
    });

    await page.close();

    if (fullText && fullText.length > 50) {
      logger.info(`[FullText] Got ${fullText.length} chars from permalink`);
      return fullText;
    }

    return null;
  } catch (e) {
    logger.error(`[FullText] Permalink navigation failed: ${(e as Error).message}`);
    if (page) {
      try { await page.close(); } catch {}
    }
    return null;
  }
};

/**
 * Clean and normalize extracted text
 */
export const cleanExtractedText = (text: string): string => {
  if (!text) return '';

  return text
    // Remove "See more" artifacts at the end
    .replace(/…\s*See more\s*$/i, '')
    .replace(/\.\.\.\s*See more\s*$/i, '')
    .replace(/…\s*ראה עוד\s*$/i, '')
    .replace(/…\s*عرض المزيد\s*$/i, '')
    .replace(/\s*See more\s*$/i, '')
    // Remove common UI elements
    .replace(/^(Like|Comment|Share|Reply)\s*/gim, '')
    .replace(/\s*(Like|Comment|Share|Reply)$/gim, '')
    .replace(/\d+\s*(likes?|comments?|shares?)/gi, '')
    .replace(/See translation/gi, '')
    .replace(/Translated by/gi, '')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

/**
 * Comprehensive full text extraction that combines all methods
 */
export const getFullPostText = async (
  page: Page,
  container: ElementHandle<Element>,
  context?: BrowserContext,
  permalinkUrl?: string
): Promise<string> => {
  let bestText = '';

  // Step 1: Try extracting after clicking "See more" in the container
  const containerText = await extractFullTextFromContainer(page, container);
  if (containerText.length > bestText.length) {
    bestText = containerText;
  }

  // Step 2: Check if we have intercepted full text that matches
  if (bestText.length > 30) {
    const intercepted = getInterceptedFullText(bestText);
    if (intercepted && intercepted.length > bestText.length) {
      bestText = intercepted;
    }
  }

  // Step 3: If text still looks truncated (ends with ellipsis), try permalink
  const looksTruncated = bestText.endsWith('…') ||
                         bestText.endsWith('...') ||
                         bestText.includes('…\n') ||
                         bestText.includes('See more');

  if (looksTruncated && context && permalinkUrl) {
    const permalinkText = await getFullTextFromPermalink(context, permalinkUrl);
    if (permalinkText && permalinkText.length > bestText.length) {
      bestText = permalinkText;
    }
  }

  return cleanExtractedText(bestText);
};

/**
 * Clear the intercepted posts cache
 */
export const clearInterceptedCache = (): void => {
  interceptedPosts.clear();
};
