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
 * Normalize a Facebook profile/page URL to a clean, consistent format
 */
const normalizeAuthorLink = (href: string | null): string | undefined => {
  if (!href) return undefined;

  try {
    const url = new URL(href, 'https://www.facebook.com');

    // Remove tracking and unnecessary parameters
    const paramsToRemove = [
      '__cft__', '__tn__', 'comment_id', 'reply_comment_id',
      'ref', 'fref', 'hc_ref', '__xts__', 'eid', 'rc', 'notif_id',
      'notif_t', 'ref_notif_type', 'acontext', 'aref'
    ];
    paramsToRemove.forEach(param => url.searchParams.delete(param));

    // Handle /user/ID format (converts to profile.php?id=)
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

    // Handle /people/Name/ID format
    if (url.pathname.includes('/people/')) {
      const match = url.pathname.match(/\/people\/[^\/]+\/(\d+)/);
      if (match) {
        return `https://www.facebook.com/profile.php?id=${match[1]}`;
      }
    }

    // Handle groups/groupid/user/userid format
    if (url.pathname.includes('/groups/') && url.pathname.includes('/user/')) {
      const match = url.pathname.match(/\/user\/(\d+)/);
      if (match) {
        return `https://www.facebook.com/profile.php?id=${match[1]}`;
      }
    }

    // Handle /username or /pagename format (no subpath)
    const pathMatch = url.pathname.match(/^\/([a-zA-Z0-9._-]+)\/?$/);
    if (pathMatch) {
      const username = pathMatch[1];
      // Exclude known non-profile paths
      const excludedPaths = [
        'groups', 'pages', 'events', 'watch', 'marketplace',
        'gaming', 'stories', 'reels', 'hashtag', 'search',
        'settings', 'notifications', 'messages', 'friends',
        'bookmarks', 'memories', 'saved', 'help', 'policies'
      ];
      if (!excludedPaths.includes(username.toLowerCase())) {
        return `https://www.facebook.com/${username}`;
      }
    }

    // If we got here with a clean facebook.com URL, return it
    if (url.hostname.includes('facebook.com') && url.pathname.length > 1) {
      // Clean up the URL
      url.search = ''; // Remove all query params for cleaner URL
      const cleanPath = url.pathname.replace(/\/+$/, ''); // Remove trailing slashes
      if (cleanPath && cleanPath !== '/') {
        return `https://www.facebook.com${cleanPath}`;
      }
    }

    return undefined;
  } catch (urlError) {
    // URL parsing failed
    logger.debug(`URL normalization failed for ${href}: ${(urlError as Error).message}`);
    return undefined;
  }
};

/**
 * Check if a URL is a valid Facebook profile/page link (not a group, post, photo, etc.)
 */
const isValidProfileLink = (href: string | null): boolean => {
  if (!href) return false;

  // Exclude non-profile links
  const excludePatterns = [
    '/groups/',
    '/posts/',
    '/comments/',
    '/photos/',
    '/photo/',
    '/events/',
    '/watch/',
    '/marketplace/',
    '/gaming/',
    '/stories/',
    '/reels/',
    '/hashtag/',
    '/share',
    '/sharer',
    '?__cft__', // tracking links without path
    '/permalink/',
  ];

  for (const pattern of excludePatterns) {
    if (href.includes(pattern) && !href.includes('/user/')) return false;
  }

  // Must be a Facebook URL
  if (!href.includes('facebook.com')) return false;

  // Valid profile patterns
  const validPatterns = [
    /\/user\/\d+/,                    // /user/123456
    /\/profile\.php\?id=\d+/,         // /profile.php?id=123456
    /\/people\/[^\/]+\/\d+/,          // /people/Name/123456
    /facebook\.com\/[a-zA-Z0-9.]+\/?$/, // /username (no subpath)
    /facebook\.com\/[a-zA-Z0-9.]+\?/, // /username?params
  ];

  return validPatterns.some(pattern => pattern.test(href));
};

/**
 * Try multiple strategies to extract author link from a post container
 * Uses 7 strategies in order of reliability
 */
const extractAuthorLink = async (container: ElementHandle<Element>): Promise<string | undefined> => {

  // Strategy 1: Profile photo link (MOST RELIABLE)
  // The circular profile photo is always linked to the author's profile
  try {
    const photoLinks = await container.$$('a[href*="facebook.com"]:has(svg[role="img"]), a[href*="facebook.com"]:has(image), a[aria-label][href*="facebook.com"]:has(img)');
    for (const link of photoLinks) {
      const href = await link.getAttribute('href');
      if (isValidProfileLink(href)) {
        const normalized = normalizeAuthorLink(href);
        if (normalized) {
          logger.debug(`Strategy 1 (profile photo): Found ${normalized}`);
          return normalized;
        }
      }
    }
  } catch (e) {
    logger.debug(`Strategy 1 failed: ${(e as Error).message}`);
  }

  // Strategy 2: Header links (h2/h3/h4) - Facebook uses h2 for author names now
  try {
    const headerLinks = await container.$$('h2 a[href], h3 a[href], h4 a[href]');
    for (const link of headerLinks) {
      const href = await link.getAttribute('href');
      if (isValidProfileLink(href)) {
        const normalized = normalizeAuthorLink(href);
        if (normalized) {
          logger.debug(`Strategy 2 (header link): Found ${normalized}`);
          return normalized;
        }
      }
    }
  } catch (e) {
    logger.debug(`Strategy 2 failed: ${(e as Error).message}`);
  }

  // Strategy 3: Links with aria-label (profile photos often have aria-label with name)
  try {
    const ariaLinks = await container.$$('a[aria-label][href*="facebook.com"]');
    for (const link of ariaLinks) {
      const href = await link.getAttribute('href');
      if (isValidProfileLink(href)) {
        const normalized = normalizeAuthorLink(href);
        if (normalized) {
          logger.debug(`Strategy 3 (aria-label link): Found ${normalized}`);
          return normalized;
        }
      }
    }
  } catch (e) {
    logger.debug(`Strategy 3 failed: ${(e as Error).message}`);
  }

  // Strategy 4: Use defined selectors from selectors.ts
  try {
    const authorLinkHandle = await findFirstHandle(container, selectors.authorLink);
    if (authorLinkHandle.handle) {
      const href = await authorLinkHandle.handle.getAttribute('href');
      if (isValidProfileLink(href)) {
        const normalized = normalizeAuthorLink(href);
        if (normalized) {
          logger.debug(`Strategy 4 (selectors): Found ${normalized}`);
          return normalized;
        }
      }
    }
  } catch (e) {
    logger.debug(`Strategy 4 failed: ${(e as Error).message}`);
  }

  // Strategy 5: Strong/bold links (author names are often in <strong> tags)
  try {
    const strongLinks = await container.$$('strong a[href*="facebook.com"], b a[href*="facebook.com"]');
    for (const link of strongLinks) {
      const href = await link.getAttribute('href');
      if (isValidProfileLink(href)) {
        const normalized = normalizeAuthorLink(href);
        if (normalized) {
          logger.debug(`Strategy 5 (strong/bold link): Found ${normalized}`);
          return normalized;
        }
      }
    }
  } catch (e) {
    logger.debug(`Strategy 5 failed: ${(e as Error).message}`);
  }

  // Strategy 6: First valid profile link in the post header area (top portion)
  try {
    const result = await container.evaluate((el) => {
      // Get all links in the container
      const allLinks = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href*="facebook.com"]'));

      // Helper to check if link is in the header area (first ~200px or first few elements)
      const isInHeaderArea = (link: HTMLAnchorElement): boolean => {
        const rect = link.getBoundingClientRect();
        const containerRect = el.getBoundingClientRect();
        // Link should be near the top of the container
        return (rect.top - containerRect.top) < 150;
      };

      // Helper to validate profile link
      const isProfile = (href: string): boolean => {
        if (!href) return false;
        const excludes = ['/groups/', '/posts/', '/comments/', '/photos/', '/photo/', '/events/', '/watch/', '/marketplace/', '/permalink/', '/share'];
        for (const ex of excludes) {
          if (href.includes(ex) && !href.includes('/user/')) return false;
        }
        // Valid patterns
        if (/\/user\/\d+/.test(href)) return true;
        if (/\/profile\.php\?id=\d+/.test(href)) return true;
        if (/\/people\/[^\/]+\/\d+/.test(href)) return true;
        // Username pattern: facebook.com/username (no subpath after username)
        const match = href.match(/facebook\.com\/([a-zA-Z0-9.]+)\/?(\?|$)/);
        if (match && !['groups', 'pages', 'events', 'watch', 'marketplace', 'gaming', 'stories'].includes(match[1])) {
          return true;
        }
        return false;
      };

      // Find first valid profile link in header area
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && isProfile(href) && isInHeaderArea(link)) {
          return href;
        }
      }

      // Fallback: any valid profile link
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href && isProfile(href)) {
          return href;
        }
      }

      return null;
    });

    if (result) {
      const normalized = normalizeAuthorLink(result);
      if (normalized) {
        logger.debug(`Strategy 6 (header area scan): Found ${normalized}`);
        return normalized;
      }
    }
  } catch (e) {
    logger.debug(`Strategy 6 failed: ${(e as Error).message}`);
  }

  // Strategy 7: Extract from any link with user ID pattern
  try {
    const allLinks = await container.$$('a[href*="/user/"], a[href*="profile.php?id="], a[href*="/people/"]');
    for (const link of allLinks) {
      const href = await link.getAttribute('href');
      if (href) {
        const normalized = normalizeAuthorLink(href);
        if (normalized) {
          logger.debug(`Strategy 7 (user ID pattern): Found ${normalized}`);
          return normalized;
        }
      }
    }
  } catch (e) {
    logger.debug(`Strategy 7 failed: ${(e as Error).message}`);
  }

  logger.debug('All author link extraction strategies failed');
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
      const loadingInfo = await container.evaluate((el: Element) => {
        const hasLoadingLabel = !!el.querySelector('[aria-label="Loading..."]');
        const hasLoadingState = !!el.querySelector('[data-visualcompletion="loading-state"]');
        const textContent = el.textContent || '';
        const textLength = textContent.length;
        const isTooShort = textLength < 30; // MIN_TEXT_LENGTH
        const preview = textContent.substring(0, 200).replace(/\s+/g, ' ').trim();

        return {
          isLoading: hasLoadingLabel || hasLoadingState || isTooShort,
          hasLoadingLabel,
          hasLoadingState,
          textLength,
          isTooShort,
          preview
        };
      });

      logger.debug(`Container ${i + 1} check: textLength=${loadingInfo.textLength}, isTooShort=${loadingInfo.isTooShort}, hasLoadingLabel=${loadingInfo.hasLoadingLabel}`);
      logger.debug(`Container ${i + 1} preview: "${loadingInfo.preview.substring(0, 100)}..."`);

      if (loadingInfo.isLoading) {
        logger.debug(`Container ${i + 1}: Skipping (loading placeholder or empty)`);
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
      logger.debug(`Container ${i + 1} info: ${containerInfo.childCount} children, ${containerInfo.textLength} chars`);
      logger.debug(`Container ${i + 1} text preview: ${containerInfo.preview}...`);
    } catch (debugErr) {
      logger.debug(`Could not debug container ${i + 1}: ${debugErr}`);
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
    
    logger.debug(`Container ${i + 1}: Found text with ${text.length} characters`);
    
    // Extract author link with enhanced extraction
    const authorLink = await extractAuthorLink(container);

    // Now get post ID (using content hash as fallback)
    const postId = normalizePostId(
      await container.getAttribute('data-ft'),
      await container.getAttribute('id'),
      text,
      authorLink
    );
    
    logger.debug(`Container ${i + 1}: Generated post ID: ${postId}`);

    // Extract author name with multiple strategies
    let authorName: string | undefined;

    // Strategy 1: Use defined selectors
    const authorHandle = await findFirstHandle(container, selectors.authorName);
    if (authorHandle.handle) {
      try {
        // Check if it's an element with aria-label (profile photo)
        const ariaLabel = await authorHandle.handle.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.length > 0 && ariaLabel.length < 100) {
          authorName = ariaLabel.trim();
        } else {
          authorName = (await authorHandle.handle.innerText())?.trim() || undefined;
        }
      } catch (authorError) {
        logger.debug(`Container ${i + 1}: Author element detached`);
      }
    }

    // Strategy 2: Try h2/h3 header text directly
    if (!authorName) {
      try {
        const headerLink = await container.$('h2 a[href*="facebook.com"], h3 a[href*="facebook.com"]');
        if (headerLink) {
          authorName = (await headerLink.innerText())?.trim() || undefined;
        }
      } catch (e) {
        logger.debug(`Container ${i + 1}: Header author extraction failed`);
      }
    }

    // Strategy 3: Get aria-label from profile photo link
    if (!authorName) {
      try {
        const photoLink = await container.$('a[aria-label][href*="facebook.com"]:has(img), a[aria-label][href*="facebook.com"]:has(svg)');
        if (photoLink) {
          const ariaLabel = await photoLink.getAttribute('aria-label');
          if (ariaLabel && ariaLabel.length > 0 && ariaLabel.length < 100) {
            authorName = ariaLabel.trim();
          }
        }
      } catch (e) {
        logger.debug(`Container ${i + 1}: Photo aria-label extraction failed`);
      }
    }

    // Strategy 4: Extract from strong/bold elements
    if (!authorName) {
      try {
        const strongLink = await container.$('strong a[href*="facebook.com"]');
        if (strongLink) {
          authorName = (await strongLink.innerText())?.trim() || undefined;
        }
      } catch (e) {
        logger.debug(`Container ${i + 1}: Strong author extraction failed`);
      }
    }

    logger.debug(`Container ${i + 1}: Author: ${authorName || 'Unknown'}, Link: ${authorLink || 'None'}`);

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
