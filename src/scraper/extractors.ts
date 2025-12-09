import { Page, ElementHandle } from 'playwright';
import { createHash } from 'crypto';
import { selectors, queryAllOnPage, findFirstHandle } from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import logger from '../utils/logger';

export interface ScrapedPost {
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  text: string;
}

const MIN_TEXT_LENGTH = 30;

const generateContentHash = (text: string, authorLink?: string): string => {
  const content = `${text}|${authorLink || ''}`;
  return createHash('sha256').update(content).digest('hex').substring(0, 32);
};

const normalizePostId = (rawId: string | null, fallback: string | null, text: string, authorLink?: string): string => {
  if (rawId) {
    try {
      const parsed = JSON.parse(rawId);
      return parsed?.top_level_post_id || parsed?.mf_story_key || rawId;
    } catch (parseError) {
      // JSON parse failed, use raw ID as-is (expected for non-JSON IDs)
      logger.debug(`Post ID parse fallback: ${(parseError as Error).message}`);
      return rawId;
    }
  }

  if (fallback) {
    return fallback;
  }

  // Generate a deterministic hash from content to prevent duplicates on re-scrape
  return `hash_${generateContentHash(text, authorLink)}`;
};

/**
 * Normalize a Facebook profile URL to a clean format
 */
const normalizeAuthorLink = (href: string | null): string | undefined => {
  if (!href) return undefined;

  try {
    const url = new URL(href, 'https://www.facebook.com');

    // Remove tracking parameters
    url.searchParams.delete('__cft__');
    url.searchParams.delete('__tn__');
    url.searchParams.delete('comment_id');
    url.searchParams.delete('reply_comment_id');

    // Handle /user/ID format
    if (url.pathname.includes('/user/')) {
      const match = url.pathname.match(/\/user\/(\d+)/);
      if (match) {
        return `https://www.facebook.com/profile.php?id=${match[1]}`;
      }
    }

    // Handle profile.php?id=X format
    if (url.pathname.includes('/profile.php')) {
      const id = url.searchParams.get('id');
      if (id) {
        return `https://www.facebook.com/profile.php?id=${id}`;
      }
    }

    // Handle /username format
    const pathMatch = url.pathname.match(/^\/([a-zA-Z0-9.]+)\/?$/);
    if (pathMatch && !['groups', 'pages', 'events', 'watch', 'marketplace'].includes(pathMatch[1])) {
      return `https://www.facebook.com/${pathMatch[1]}`;
    }

    return href;
  } catch (urlError) {
    // URL parsing failed, return original href
    logger.debug(`URL normalization fallback for ${href}: ${(urlError as Error).message}`);
    return href;
  }
};

/**
 * Try multiple strategies to extract author link from a post container
 */
const extractAuthorLink = async (container: ElementHandle<Element>): Promise<string | undefined> => {
  // Strategy 1: Use defined selectors
  const authorLinkHandle = await findFirstHandle(container, selectors.authorLink);
  if (authorLinkHandle.handle) {
    const href = await authorLinkHandle.handle.getAttribute('href');
    const normalized = normalizeAuthorLink(href);
    if (normalized) return normalized;
  }

  // Strategy 2: Find any link in the header area (h2, h3, h4) that points to a profile
  const headerLinks = await container.$$('h2 a[href], h3 a[href], h4 a[href]');
  for (const link of headerLinks) {
    const href = await link.getAttribute('href');
    if (href && (href.includes('/user/') || href.includes('/profile.php') || href.includes('facebook.com/'))) {
      const normalized = normalizeAuthorLink(href);
      if (normalized && !normalized.includes('/groups/')) return normalized;
    }
  }

  // Strategy 3: Find links with aria-label containing author info
  const ariaLinks = await container.$$('a[aria-label][href*="facebook.com"]');
  for (const link of ariaLinks) {
    const href = await link.getAttribute('href');
    if (href && (href.includes('/user/') || href.includes('/profile.php'))) {
      return normalizeAuthorLink(href);
    }
  }

  // Strategy 4: Evaluate in page to find the most "profile-like" link
  try {
    const guessedLink = await container.evaluate((el) => {
      const anchors = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'));

      const cleanHref = (href: string) => href.replace(/^https?:\/\/(www\.)?facebook\.com/i, '');

      const isProfileLike = (href: string) => {
        if (!href) return false;
        if (href.includes('/groups/') && !href.includes('/user/')) return false;
        if (href.includes('/posts/')) return false;
        if (href.includes('/comments/')) return false;
        if (href.includes('/photos/')) return false;
        if (href.includes('/events/')) return false;
        return /\/(user|profile\.php|people)\//.test(href) || /^[\/][A-Za-z0-9.]+\/?$/.test(cleanHref(href));
      };

      const candidate = anchors.find((a) => isProfileLike(a.getAttribute('href') || ''));
      return candidate?.getAttribute('href') || undefined;
    });

    if (guessedLink) {
      return normalizeAuthorLink(guessedLink);
    }
  } catch (linkError) {
    logger.debug(`Author link evaluate fallback failed: ${(linkError as Error).message}`);
  }

  return undefined;
};

export const extractPosts = async (page: Page): Promise<ScrapedPost[]> => {
  const posts: ScrapedPost[] = [];
  
  logger.info('Starting post extraction...');
  
  // Try to find containers
  let { handles: containers, selector: usedSelector } = await queryAllOnPage(page, selectors.postContainer);
  
  logger.info(`Found ${containers.length} post containers using selector: ${usedSelector}`);
  
  if (containers.length === 0) {
    logger.warn('No post containers found! Trying alternative selectors...');

    // Debug: Log page content structure
    const pageContent = await page.content();
    logger.info(`Page has ${pageContent.length} characters of HTML`);

    // Try to find any divs with role="article"
    const articleDivs = await page.$$('div[role="article"]');
    logger.info(`Found ${articleDivs.length} divs with role="article"`);

    if (articleDivs.length) {
      containers = articleDivs;
      usedSelector = 'div[role="article"] (fallback)';
    } else {
      // Try to find feed units
      const feedUnits = await page.$$('div[data-pagelet^="FeedUnit"] div[role="article"]');
      logger.info(`Found ${feedUnits.length} feed unit divs with articles`);
      containers = feedUnits;
      usedSelector = 'div[data-pagelet^="FeedUnit"] div[role="article"] (fallback)';
    }

    if (!containers.length) {
      logger.warn('Still no containers after fallback selectors.');
      return posts;
    }
  }

  // Debug: If we only found a few containers, try to get more from the feed
  if (containers.length <= 3) {
    logger.info('Few containers found, trying deeper search...');
    // Try to find all role="article" that are nested (actual posts vs headers)
    const nestedArticles = await page.$$('div[role="feed"] div[role="article"]');
    if (nestedArticles.length > containers.length) {
      logger.info(`Found ${nestedArticles.length} nested articles in feed`);
      containers.splice(0, containers.length, ...nestedArticles);
    }
  }
  
  const limit = Math.floor(Math.random() * 21) + 20; // 20-40 posts

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    
    logger.info(`Processing container ${i + 1}/${containers.length}`);

    // Check if container is a loading placeholder
    try {
      const isLoading = await container.evaluate((el) => {
        // Check if it's a loading placeholder
        if (el.querySelector('[aria-label="Loading..."]')) return true;
        if (el.querySelector('[data-visualcompletion="loading-state"]')) return true;
        // Check if it has very little text content
        const textContent = el.textContent || '';
        if (textContent.length < MIN_TEXT_LENGTH) return true;
        return false;
      });

      if (isLoading) {
        logger.info(`Container ${i + 1}: Skipping (loading placeholder or empty)`);
        continue;
      }
    } catch (loadingCheckError) {
      // Continue with extraction even if loading check fails
      logger.debug(`Container ${i + 1}: Loading check failed, continuing: ${(loadingCheckError as Error).message}`);
    }

    // Debug: Get container size and some content info
    try {
      const containerInfo = await container.evaluate((el) => ({
        textLength: (el.textContent || '').length,
        childCount: el.children.length,
        tagName: el.tagName,
        preview: (el.textContent || '').substring(0, 150).replace(/\s+/g, ' '),
      }));
      logger.info(`Container ${i + 1} info: ${containerInfo.childCount} children, ${containerInfo.textLength} chars`);
      logger.info(`Container ${i + 1} text preview: ${containerInfo.preview}...`);
    } catch (debugErr) {
      logger.warn(`Could not debug container ${i + 1}: ${debugErr}`);
    }

    // Extract text first (we need it for ID generation)
    let text = '';

    // Strategy 1: Try specific text selectors
    for (const textSelector of selectors.postTextCandidates) {
      const textHandle = await container.$(textSelector);
      if (textHandle) {
        const candidate = (await textHandle.innerText())?.trim();
        if (candidate && candidate.length > text.length) {
          text = candidate;
        }
      }
    }

    // Strategy 2: If no text found, try to find the main content div with See more
    if (!text || text.length < MIN_TEXT_LENGTH) {
      const seeMoreParent = await container.$('div:has(div[role="button"]:text-matches("See more|See More|...more"))');
      if (seeMoreParent) {
        const candidate = (await seeMoreParent.innerText())?.trim();
        if (candidate && candidate.length > text.length) {
          text = candidate.replace(/See more|See More|\.\.\.more/g, '').trim();
        }
      }
    }

    // Strategy 3: Try to get text from all divs with dir="auto" and longer content
    if (!text || text.length < MIN_TEXT_LENGTH) {
      const autoDirs = await container.$$('div[dir="auto"]');
      for (const div of autoDirs) {
        try {
          const candidate = (await div.innerText())?.trim();
          // Only use text longer than current and appears to be actual content
          if (candidate && candidate.length > text.length && candidate.length >= MIN_TEXT_LENGTH) {
            // Skip if it looks like a button or UI element
            if (candidate.includes('Like') && candidate.length < MIN_TEXT_LENGTH) continue;
            if (candidate.includes('Comment') && candidate.length < MIN_TEXT_LENGTH) continue;
            if (candidate.includes('Share') && candidate.length < MIN_TEXT_LENGTH) continue;
            text = candidate;
          }
        } catch (elementError) {
          // Element may have detached from DOM during iteration
          logger.debug(`Container ${i + 1}: Element detached during text extraction`);
        }
      }
    }

    // Strategy 4: As last resort, get innerText of the whole container (excluding navigation elements)
    if (!text || text.length < MIN_TEXT_LENGTH) {
      try {
        const fullText = await container.innerText();
        // Clean up the text - remove common UI elements
        const cleaned = fullText
          ?.replace(/Like|Comment|Share|Reply|See more|See More|\d+ comments?|\d+ shares?/gi, '')
          .replace(/\n+/g, '\n')
          .trim();
        if (cleaned && cleaned.length > text.length && cleaned.length >= MIN_TEXT_LENGTH) {
          text = cleaned;
        }
      } catch (containerError) {
        // Container may have detached from DOM
        logger.debug(`Container ${i + 1}: Container detached during full text extraction`);
      }
    }

    if (!text || text.length < MIN_TEXT_LENGTH) {
      logger.warn(`Container ${i + 1}: Text too short or missing (${text.length} chars)`);
      continue;
    }
    
    logger.info(`Container ${i + 1}: Found text with ${text.length} characters`);
    
    // Extract author link with enhanced extraction
    const authorLink = await extractAuthorLink(container);

    // Now get post ID (using content hash as fallback)
    const postId = normalizePostId(
      await container.getAttribute('data-ft'),
      await container.getAttribute('id'),
      text,
      authorLink
    );
    
    logger.info(`Container ${i + 1}: Generated post ID: ${postId}`);

    // Extract author name
    const authorHandle = await findFirstHandle(container, selectors.authorName);
    let authorName: string | undefined;
    if (authorHandle.handle) {
      try {
        authorName = (await authorHandle.handle.innerText())?.trim() || undefined;
      } catch (authorError) {
        // Element might have been removed from DOM
        logger.debug(`Container ${i + 1}: Author element detached`);
      }
    }

    logger.info(`Container ${i + 1}: Author: ${authorName || 'Unknown'}, Link: ${authorLink || 'None'}`);

    posts.push({
      fbPostId: postId,
      authorName,
      authorLink,
      text,
    });

    if (posts.length >= limit) break;
  }

  await humanDelay();
  
  logger.info(`Extraction complete: Found ${posts.length} valid posts`);

  return posts;
};
