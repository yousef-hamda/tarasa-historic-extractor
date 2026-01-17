import { Page, ElementHandle, BrowserContext } from 'playwright';
import { createHash } from 'crypto';
import { selectors, queryAllOnPage, findFirstHandle } from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import logger from '../utils/logger';
import {
  expandAllSeeMoreButtons,
  extractFullTextFromContainer,
  getInterceptedFullText,
  getInterceptedPostId,
  cleanExtractedText,
  setupPostInterception,
  clearInterceptedCache,
} from './fullTextExtractor';

export interface ScrapedPost {
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  authorPhoto?: string;
  text: string;
  postUrl?: string;  // Direct link to the Facebook post
}

const MIN_TEXT_LENGTH = 30;

/**
 * Clean post text by removing Facebook UI elements
 */
const cleanPostText = (text: string | null | undefined): string => {
  if (!text) return '';

  // UI elements to remove (case insensitive patterns)
  const uiPatterns = [
    // Engagement buttons
    /^Like$/gim,
    /^Comment$/gim,
    /^Share$/gim,
    /^Reply$/gim,
    /^Send$/gim,
    // Time indicators
    /^\d+[hdwmy]$/gim,  // 5d, 2h, 1w, 3m, 1y
    /^\d+\s*(hour|hours|day|days|week|weeks|month|months|year|years)\s*ago$/gim,
    /^Just now$/gim,
    /^Yesterday$/gim,
    // Translation and more
    /^See translation$/gim,
    /^See original$/gim,
    /^See more$/gim,
    /^See More$/gim,
    /^\.\.\.more$/gim,
    /^Translated by$/gim,
    /See more\.\.\.$/gim,  // "See more..." at end of line
    /ראה עוד$/gim,  // Hebrew "See more"
    /עוד\.\.\.$/gim,  // Hebrew "more..."
    /عرض المزيد$/gim,  // Arabic "See more"
    // Reactions
    /^\d+\s*comments?$/gim,
    /^\d+\s*shares?$/gim,
    /^\d+\s*likes?$/gim,
    /^\d+\s*reactions?$/gim,
    /^All comments$/gim,
    /^Most relevant$/gim,
    /^Newest$/gim,
    // Write comment prompts
    /^Write a comment\.\.\.$/gim,
    /^Write a public comment\.\.\.$/gim,
    // Author repeated at start (after name extraction)
    /^Author$/gim,
    // Group info
    /^Group$/gim,
    /^Public group$/gim,
    /^Private group$/gim,
    // Misc UI
    /^Hide$/gim,
    /^Report$/gim,
    /^Save$/gim,
    /^Copy link$/gim,
    /^Turn on notifications$/gim,
  ];

  // Split by newlines and filter out UI elements
  const lines = text.split('\n');
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    // Check against all UI patterns
    for (const pattern of uiPatterns) {
      pattern.lastIndex = 0; // Reset regex state
      if (pattern.test(trimmed)) {
        return false;
      }
    }

    // Remove lines that are just the author name repeated (single short word at start)
    if (trimmed.length < 3) return false;

    return true;
  });

  // Join and clean up extra whitespace
  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .trim();
};

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

export const extractPosts = async (page: Page, context?: BrowserContext): Promise<ScrapedPost[]> => {
  logger.info('Starting post extraction with enhanced full-text support...');

  // STEP 1: Expand ALL "See more" buttons on the page FIRST
  // This is crucial for getting full text from truncated posts
  logger.info('Expanding all "See more" buttons before extraction...');
  try {
    const expandedCount = await expandAllSeeMoreButtons(page);
    if (expandedCount > 0) {
      logger.info(`Expanded ${expandedCount} "See more" buttons`);
      // Wait for content to fully render after expansion
      await page.waitForTimeout(1000);
    }
  } catch (expandError) {
    logger.warn(`Failed to expand "See more" buttons: ${(expandError as Error).message}`);
  }

  // NEW: First try the feed children method (works better with current FB structure)
  // This method doesn't rely on role="article" which only applies to comments
  const hasFeed = await page.$('div[role="feed"]');
  if (hasFeed) {
    logger.info('Feed found, using feed children extraction method (primary)...');

    // Check if we have any role="article" that are main posts (not comments)
    const articlesInfo = await page.evaluate(() => {
      const articles = document.querySelectorAll('div[role="article"]');
      let mainPosts = 0;
      let comments = 0;
      for (const a of articles) {
        const label = a.getAttribute('aria-label') || '';
        if (label.toLowerCase().includes('comment')) {
          comments++;
        } else if (label && !label.includes('Loading')) {
          mainPosts++;
        }
      }
      return { total: articles.length, mainPosts, comments };
    });

    logger.info(`Articles check: ${articlesInfo.mainPosts} main posts, ${articlesInfo.comments} comments, ${articlesInfo.total} total`);

    // If most articles are comments or we have no main posts, use feed children method
    if (articlesInfo.mainPosts < 3 || articlesInfo.comments > articlesInfo.mainPosts) {
      logger.info('Most role="article" elements are comments - using feed children method');
      const feedChildrenPosts = await extractPostsFromFeedChildren(page);
      if (feedChildrenPosts.length > 0) {
        return feedChildrenPosts;
      }
      logger.warn('Feed children method found no posts, falling back to article-based extraction');
    }
  }

  // FALLBACK: Original article-based extraction
  const posts: ScrapedPost[] = [];

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
      // Try alternative extraction method for groups with different DOM structure
      return extractPostsAlternative(page);
    }
  }

  // Check if containers have actual text content - if not, use alternative method
  if (containers.length > 0) {
    const firstContainerText = await containers[0].evaluate((el: Element) => (el.textContent || '').length);
    if (firstContainerText < 30) {
      logger.warn('Article containers found but empty - trying alternative extraction...');
      return extractPostsAlternative(page);
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

    // ENHANCED: Click "See more" button using JavaScript injection for better reliability
    // This uses multiple strategies to ensure the full text is expanded
    try {
      const expandedInContainer = await container.evaluate((el) => {
        let clicked = 0;
        const seeMorePatterns = [
          'See more', 'See More', '...more', '… more',
          'ראה עוד', 'עוד',           // Hebrew
          'عرض المزيد', 'المزيد',      // Arabic
          'Ver más', 'Voir plus',     // Spanish, French
        ];

        // Strategy 1: Find all clickable elements with "See more" text
        const allElements = el.querySelectorAll('[role="button"], span, div, a');
        for (const elem of allElements) {
          const text = (elem as HTMLElement).innerText?.trim();
          if (text && seeMorePatterns.some(p => {
            const lowerText = text.toLowerCase();
            const lowerPattern = p.toLowerCase();
            return lowerText === lowerPattern || lowerText.includes(lowerPattern);
          })) {
            try {
              // Try native click first
              (elem as HTMLElement).click();
              clicked++;
            } catch {
              // Fallback: dispatch mouse event
              try {
                elem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                clicked++;
              } catch {}
            }
          }
        }

        // Strategy 2: Look for truncated text with ellipsis and click the following element
        const textDivs = el.querySelectorAll('div[dir="auto"], span[dir="auto"]');
        for (const div of textDivs) {
          const html = div.innerHTML || '';
          const text = (div as HTMLElement).innerText || '';
          // Check for truncation indicators
          if (text.endsWith('…') || html.includes('…') || text.includes('...more')) {
            // Find sibling or child clickable element
            const clickable = div.querySelector('[role="button"]') ||
                             div.nextElementSibling?.querySelector('[role="button"]') ||
                             div.parentElement?.querySelector('[role="button"]:not(:first-child)');
            if (clickable) {
              try {
                (clickable as HTMLElement).click();
                clicked++;
              } catch {}
            }
          }
        }

        return clicked;
      });

      if (expandedInContainer > 0) {
        // Wait for content to expand after clicking
        await new Promise(resolve => setTimeout(resolve, 800));
        logger.debug(`Container ${i + 1}: Expanded ${expandedInContainer} "See more" elements`);
      }
    } catch (seeMoreError) {
      logger.debug(`Container ${i + 1}: Could not expand "See more": ${(seeMoreError as Error).message}`);
    }

    // ENHANCED TEXT EXTRACTION: Use comprehensive extraction with full-text support
    let text = '';

    // Use the enhanced full text extraction from the container
    try {
      text = await extractFullTextFromContainer(page, container);
      if (text) {
        logger.debug(`Container ${i + 1}: Enhanced extraction got ${text.length} chars`);
      }
    } catch (enhancedError) {
      logger.debug(`Container ${i + 1}: Enhanced extraction failed: ${(enhancedError as Error).message}`);
    }

    // Strategy 1: Find the main post content div (usually has data-ad-preview or dir="auto")
    if (!text || text.length < MIN_TEXT_LENGTH) {
      try {
        const contentDiv = await container.$('div[data-ad-preview="message"], div[data-ad-comet-preview="message"]');
        if (contentDiv) {
          const candidate = (await contentDiv.innerText())?.trim();
          if (candidate && candidate.length > text.length) {
            text = candidate;
          }
        }
      } catch {
        // Continue to next strategy
      }
    }

    // Strategy 2: Try specific text selectors
    if (!text || text.length < MIN_TEXT_LENGTH) {
      for (const textSelector of selectors.postTextCandidates) {
        const textHandle = await container.$(textSelector);
        if (textHandle) {
          const candidate = (await textHandle.innerText())?.trim();
          if (candidate && candidate.length > text.length) {
            text = candidate;
          }
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
        const cleaned = cleanPostText(fullText);
        if (cleaned && cleaned.length > text.length && cleaned.length >= MIN_TEXT_LENGTH) {
          text = cleaned;
        }
      } catch (containerError) {
        // Container may have detached from DOM
        logger.debug(`Container ${i + 1}: Container detached during full text extraction`);
      }
    }

    // Strategy 5: Check intercepted GraphQL data for full text that matches
    if (text && text.length >= MIN_TEXT_LENGTH) {
      const interceptedFullText = getInterceptedFullText(text);
      if (interceptedFullText && interceptedFullText.length > text.length) {
        logger.debug(`Container ${i + 1}: Found longer intercepted text (${interceptedFullText.length} vs ${text.length})`);
        text = interceptedFullText;
      }
    }

    // Always clean the final text to remove any UI elements
    text = cleanExtractedText(text) || cleanPostText(text);

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

    // Extract post URL (permalink) - search container, parents, and by proximity
    let postUrl: string | undefined;
    try {
      postUrl = await container.evaluate((el) => {
        let foundUrl: string | null = null;

        // Strategy 1: Find permalink link in container
        const permalinkPatterns = [
          'a[href*="/posts/"]',
          'a[href*="/permalink/"]',
          'a[href*="story_fbid="]',
          'a[href*="pfbid"]',
        ];

        for (const pattern of permalinkPatterns) {
          const link = el.querySelector(pattern);
          if (link) {
            const href = link.getAttribute('href');
            if (href) {
              foundUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
              break;
            }
          }
        }

        // Strategy 2: Search parent containers (timestamp links are often higher up)
        if (!foundUrl) {
          let searchEl: Element | null = el;
          for (let level = 0; level < 8 && searchEl && !foundUrl; level++) {
            searchEl = searchEl.parentElement;
            if (!searchEl || searchEl.getAttribute('role') === 'feed') break;

            const timestampLinks = searchEl.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="pfbid"]');
            for (const link of timestampLinks) {
              const href = link.getAttribute('href') || '';
              const text = (link as HTMLElement).innerText?.trim() || '';

              // Check if timestamp-like text
              const isTimestamp = text.length < 15 && (
                text.match(/^\d+\s*[hdwmy]$/i) ||
                text.match(/^(just now|yesterday|today)/i)
              );

              if (isTimestamp || href.includes('/posts/')) {
                foundUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
                break;
              }
            }
          }
        }

        // Strategy 3: Search by proximity - find nearest post link in feed
        if (!foundUrl) {
          const elRect = el.getBoundingClientRect();
          const feed = document.querySelector('div[role="feed"]');
          if (feed) {
            const allPostLinks = feed.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
            let closestLink: Element | null = null;
            let closestDistance = 200;

            for (const link of allPostLinks) {
              const linkRect = link.getBoundingClientRect();
              const distance = Math.abs(linkRect.top - elRect.top);

              if (distance < closestDistance) {
                closestDistance = distance;
                closestLink = link;
              }
            }

            if (closestLink) {
              const href = closestLink.getAttribute('href');
              if (href) {
                foundUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
              }
            }
          }
        }

        // Clean URL - remove tracking params
        if (foundUrl) {
          try {
            const url = new URL(foundUrl, 'https://www.facebook.com');
            url.searchParams.delete('comment_id');
            url.searchParams.delete('reply_comment_id');
            url.searchParams.delete('__cft__[0]');
            url.searchParams.delete('__tn__');
            return url.toString();
          } catch {
            return foundUrl;
          }
        }

        return undefined;
      });
    } catch (e) {
      logger.debug(`Container ${i + 1}: Post URL extraction failed: ${(e as Error).message}`);
    }

    logger.debug(`Container ${i + 1}: Generated post ID: ${postId}, URL: ${postUrl || 'None'}`);


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

    // Extract author photo with multiple strategies
    // NOTE: Facebook now uses SVG <image> elements with href attribute for profile photos
    let authorPhoto: string | undefined;
    try {
      // Strategy 1: Use page.evaluate for comprehensive SVG image search
      // This is the most reliable as Facebook uses SVG images now
      authorPhoto = await container.evaluate((el) => {
        // First, look for SVG images (Facebook's current profile photo structure)
        const svgImages = el.querySelectorAll('svg image');
        for (const img of svgImages) {
          const rect = img.getBoundingClientRect();
          const containerRect = el.getBoundingClientRect();
          // Only consider images near the top (profile photos are in the header)
          if (rect.top - containerRect.top < 150) {
            // Facebook uses 'href' attribute now (not xlink:href)
            const href = img.getAttribute('href') ||
                        img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                        img.getAttribute('xlink:href');
            if (href && (href.includes('scontent') || href.includes('fbcdn'))) {
              return href;
            }
          }
        }

        // Fallback: Look for regular img elements
        const images = el.querySelectorAll('img');
        for (const img of images) {
          const rect = img.getBoundingClientRect();
          const containerRect = el.getBoundingClientRect();
          if (rect.top - containerRect.top < 150) {
            const src = img.getAttribute('src');
            if (src && (src.includes('scontent') || src.includes('fbcdn'))) {
              return src;
            }
          }
        }

        return undefined;
      });

      if (authorPhoto) {
        logger.debug(`Container ${i + 1}: Found photo via evaluate`);
      }

      // Strategy 2: Try specific selectors as fallback
      if (!authorPhoto) {
        const photoSelectors = [
          'svg image[href*="scontent"]',
          'svg image[href*="fbcdn"]',
          'a[href*="/user/"] svg image',
          'a[href*="profile.php"] svg image',
          'img[src*="scontent"]',
          'img[src*="fbcdn"]',
        ];

        for (const selector of photoSelectors) {
          if (authorPhoto) break;
          try {
            const photoEl = await container.$(selector);
            if (photoEl) {
              let src = await photoEl.getAttribute('href');
              if (!src) src = await photoEl.getAttribute('src');
              if (!src) {
                src = await photoEl.evaluate((el) => {
                  return el.getAttribute('href') ||
                         el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                         (el as HTMLImageElement).src;
                });
              }
              if (src && (src.includes('scontent') || src.includes('fbcdn'))) {
                authorPhoto = src;
                logger.debug(`Container ${i + 1}: Found photo with selector: ${selector}`);
              }
            }
          } catch {
            // Try next selector
          }
        }
      }
    } catch (e) {
      logger.debug(`Container ${i + 1}: Photo extraction failed: ${(e as Error).message}`);
    }

    logger.debug(`Container ${i + 1}: Author: ${authorName || 'Unknown'}, Link: ${authorLink || 'None'}, Photo: ${authorPhoto ? 'Yes' : 'No'}, PostURL: ${postUrl ? 'Yes' : 'No'}`);

    posts.push({
      fbPostId: postId,
      authorName,
      authorLink,
      authorPhoto,
      text,
      postUrl,
    });

    if (posts.length >= limit) break;
  }

  await humanDelay();

  logger.info(`Extraction complete: Found ${posts.length} valid posts`);

  return posts;
};

/**
 * NEW: Primary extraction method - Feed Children Based
 * This method works with Facebook's current DOM structure where:
 * - Main posts do NOT have role="article" (only comments do)
 * - Posts are direct/nested children of div[role="feed"]
 * - Author names are in aria-label on profile links
 * - Post text is in div[dir="auto"] elements
 * - Profile photos are SVG images with href containing scontent/fbcdn
 *
 * URL MATCHING: Uses two-phase approach to ensure each unique URL is only assigned once:
 * 1. First, collect all unique post URLs in the feed with their Y positions
 * 2. Assign URLs to posts based on proximity, each URL used only once
 */
const extractPostsFromFeedChildren = async (page: Page): Promise<ScrapedPost[]> => {
  logger.info('Using feed children extraction method...');
  const posts: ScrapedPost[] = [];
  const seenTexts = new Set<string>();

  const extractedPosts = await page.evaluate(() => {
    const results: Array<{
      text: string;
      authorName: string | null;
      authorLink: string | null;
      authorPhoto: string | null;
      postUrl: string | null;
    }> = [];

    const feed = document.querySelector('div[role="feed"]');
    if (!feed) {
      console.log('No feed found');
      return results;
    }

    // ====== PHASE 1: COLLECT ALL UNIQUE POST URLs ======
    // Collect all post URLs in the feed with their positions
    // Each unique post ID should only appear once
    const postUrlMap = new Map<string, { url: string; y: number; used: boolean }>();

    // Extract group ID from current URL for constructing post URLs
    const groupIdMatch = window.location.pathname.match(/\/groups\/(\d+)/);
    const groupId = groupIdMatch ? groupIdMatch[1] : '';

    // Strategy A: Direct post links
    const allPostLinks = feed.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="pfbid"]');
    for (const link of allPostLinks) {
      const href = link.getAttribute('href') || '';
      const rect = link.getBoundingClientRect();

      // Extract clean URL without comment params
      let cleanUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
      try {
        const url = new URL(cleanUrl, 'https://www.facebook.com');
        // Remove comment and tracking params for clean permalink
        url.searchParams.delete('comment_id');
        url.searchParams.delete('reply_comment_id');
        url.searchParams.delete('__cft__[0]');
        url.searchParams.delete('__tn__');
        cleanUrl = url.toString();
      } catch {}

      // Extract post ID for deduplication
      const postIdMatch = cleanUrl.match(/\/posts\/(\d+)/);
      const postId = postIdMatch ? postIdMatch[1] : cleanUrl; // Use full URL as key if no ID

      // Only keep the entry with smallest Y (highest on page) for each post ID
      const existing = postUrlMap.get(postId);
      if (!existing || rect.top < existing.y) {
        postUrlMap.set(postId, { url: cleanUrl, y: rect.top, used: false });
      }
    }

    // Strategy B: Extract post IDs from photo URLs (set=pcb.XXXXXXX pattern)
    // This is valuable because photo posts have the post ID in the photo URL
    const photoLinks = feed.querySelectorAll('a[href*="set=pcb."]');
    for (const link of photoLinks) {
      const href = link.getAttribute('href') || '';
      const rect = link.getBoundingClientRect();

      // Extract post ID from set=pcb.XXXXXXX
      const pcbMatch = href.match(/set=pcb\.(\d+)/);
      if (pcbMatch && groupId) {
        const postId = pcbMatch[1];

        // Check if we already have this post ID
        if (!postUrlMap.has(postId)) {
          // Construct the post URL
          const postUrl = `https://www.facebook.com/groups/${groupId}/posts/${postId}`;
          postUrlMap.set(postId, { url: postUrl, y: rect.top, used: false });
        }
      }
    }

    console.log(`Found ${postUrlMap.size} unique post URLs in feed`);

    // ====== PHASE 2: FIND TEXT ELEMENTS ======
    const feedChildren = Array.from(feed.children);
    console.log(`Feed has ${feedChildren.length} children`);

    // Find ALL substantial text elements in the page (not in comments)
    const allDirAuto = document.querySelectorAll('div[dir="auto"], span[dir="auto"]');
    const textElements: Array<{
      element: HTMLElement;
      text: string;
      y: number;
    }> = [];

    for (const el of allDirAuto) {
      const text = (el as HTMLElement).innerText?.trim() || '';

      // Skip if too short or looks like UI element
      if (text.length < 80) continue;
      if (text.match(/^(Like|Comment|Share|Reply|See more|See translation|Write a)/i)) continue;
      if (text.includes('See less') && text.length < 150) continue;

      // Skip garbled text (single characters on multiple lines - common with animated/stylized text)
      // Check if text is mostly single characters per line
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      if (lines.length > 10) {
        const singleCharLines = lines.filter(l => l.trim().length <= 2).length;
        const ratio = singleCharLines / lines.length;
        if (ratio > 0.7) {
          // More than 70% single-char lines = probably garbled
          continue;
        }
      }

      // Check if inside a comment article
      const parentArticle = el.closest('div[role="article"]');
      const isInsideComment = parentArticle &&
        (parentArticle.getAttribute('aria-label') || '').toLowerCase().includes('comment');
      if (isInsideComment) continue;

      // Check if inside the feed
      if (!feed.contains(el)) continue;

      const rect = el.getBoundingClientRect();
      textElements.push({
        element: el as HTMLElement,
        text,
        y: rect.top
      });
    }

    console.log(`Found ${textElements.length} potential post text elements`);

    // Sort by Y position (top to bottom)
    textElements.sort((a, b) => a.y - b.y);

    // Deduplicate - only remove near-identical texts
    // Keep the longer version when texts are very similar (>80% overlap)
    const uniqueTexts: typeof textElements = [];
    for (const item of textElements) {
      let isDuplicate = false;
      for (let i = 0; i < uniqueTexts.length; i++) {
        const existing = uniqueTexts[i];
        const shorter = item.text.length < existing.text.length ? item.text : existing.text;
        const longer = item.text.length >= existing.text.length ? item.text : existing.text;

        // Check if shorter text is mostly contained in longer
        // Use first 70 chars for comparison (more precise than 50)
        const compareLen = Math.min(70, shorter.length);
        if (longer.includes(shorter.substring(0, compareLen))) {
          // These are duplicates - keep the longer one
          if (item.text.length > existing.text.length) {
            uniqueTexts[i] = item;
          }
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        uniqueTexts.push(item);
      }
    }

    // Add debug info that will be visible in the returned results
    const _debugInfo = {
      totalDirAuto: allDirAuto.length,
      afterFiltering: textElements.length,
      afterDedup: uniqueTexts.length,
      samples: uniqueTexts.slice(0, 5).map(t => t.text.substring(0, 40))
    };
    console.log('DEBUG:', JSON.stringify(_debugInfo));

    // For each text element, find associated author info
    for (const textItem of uniqueTexts) {
      const textElement = textItem.element;
      const postText = textItem.text;

      // Container finding: walk up until we find a div that has BOTH:
      // 1. A profile link (author)
      // 2. The text element itself
      // STOP as soon as we find one - don't keep going up
      let container: HTMLElement | null = textElement;
      let foundContainer = false;

      // Walk up looking for the CLOSEST container with a profile link
      let current: HTMLElement | null = textElement.parentElement;
      for (let i = 0; i < 15 && current; i++) {
        // Stop at feed level
        if (current.getAttribute('role') === 'feed') break;

        // Check if this level has a profile link
        const hasProfileLink = !!current.querySelector('a[href*="/user/"], a[href*="profile.php"]');

        if (hasProfileLink) {
          // Found a container with profile link - use this one and STOP
          container = current;
          foundContainer = true;
          break;  // Don't keep searching for larger containers
        }

        current = current.parentElement;
      }

      // If we didn't find a container with profile link, just use parent levels
      if (!foundContainer) {
        container = textElement.parentElement?.parentElement?.parentElement || textElement;
        foundContainer = true;  // Use whatever we have
      }

      if (!container) {
        console.log(`No container for: "${postText.substring(0, 30)}..."`);
        continue;
      }

      // Skip if inside a comment article
      const parentArticle = textElement.closest('div[role="article"]');
      if (parentArticle && (parentArticle.getAttribute('aria-label') || '').toLowerCase().includes('comment')) {
        continue;
      }

      // Use this container for author/URL extraction
      const el = container;

      // === EXTRACT AUTHOR INFO ===
      // CRITICAL: The author is ALWAYS at the TOP of the post, with a profile photo
      // Mentioned users/pages appear IN or BELOW the text - we must NOT pick those up!
      // Strategy: Find the TOP-MOST profile photo in the container - that's the author
      let authorName: string | null = null;
      let authorLink: string | null = null;
      let authorPhoto: string | null = null;

      const textY = textItem.y;
      // elRect is available if needed for relative positioning

      // STRATEGY 1: Find ALL profile photos and take the TOP-MOST one
      // The author's photo is always at the very top of the post
      const photoInfos: Array<{
        y: number;
        photo: string;
        link: string | null;
        name: string | null;
      }> = [];

      const svgImages = el.querySelectorAll('svg image');
      for (const img of svgImages) {
        const href = img.getAttribute('href') ||
                    img.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                    img.getAttribute('xlink:href');

        if (href && (href.includes('scontent') || href.includes('fbcdn'))) {
          const rect = img.getBoundingClientRect();

          // Find parent link
          let link: string | null = null;
          let name: string | null = null;
          let parent = img.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            if (parent.tagName === 'A') {
              const parentHref = parent.getAttribute('href') || '';
              if (parentHref.includes('/user/') || parentHref.includes('profile.php')) {
                link = parentHref;
                name = parent.getAttribute('aria-label');
                break;
              }
            }
            parent = parent.parentElement;
          }

          photoInfos.push({
            y: rect.top,
            photo: href,
            link,
            name
          });
        }
      }

      // Sort by Y position (top to bottom) and take the TOP-MOST
      photoInfos.sort((a, b) => a.y - b.y);

      if (photoInfos.length > 0) {
        const topPhoto = photoInfos[0];
        // Only use if it has a valid profile link (the author's photo always has one)
        if (topPhoto.link) {
          authorPhoto = topPhoto.photo;
          authorLink = topPhoto.link;
          authorName = topPhoto.name;
        }
      }

      // STRATEGY 2: If no photo found, look for profile link ABOVE the text
      // The author link is always ABOVE the post text (negative Y difference)
      if (!authorLink) {
        const profileLinks = el.querySelectorAll('a[aria-label][href*="/user/"], a[aria-label][href*="profile.php"]');
        const linkInfos: Array<{ y: number; link: string; name: string }> = [];

        for (const link of profileLinks) {
          const rect = link.getBoundingClientRect();
          const ariaLabel = link.getAttribute('aria-label');
          const href = link.getAttribute('href') || '';

          // Only consider links ABOVE the text
          if (rect.top < textY && ariaLabel && ariaLabel.length > 1 && ariaLabel.length < 60 &&
              !ariaLabel.includes('Like') && !ariaLabel.includes('Comment') &&
              !ariaLabel.includes('Share') && !ariaLabel.includes('Actions')) {
            linkInfos.push({
              y: rect.top,
              link: href,
              name: ariaLabel
            });
          }
        }

        // Take the TOP-MOST profile link (author is at top)
        linkInfos.sort((a, b) => a.y - b.y);
        if (linkInfos.length > 0) {
          authorLink = linkInfos[0].link;
          authorName = linkInfos[0].name;
        }
      }

      // STRATEGY 3: Look in h2/h3/h4 headers for author name (they're always at top)
      if (!authorName) {
        const headerLinks = el.querySelectorAll('h2 a[href*="/user/"], h3 a[href*="/user/"], h4 a[href*="/user/"], h2 a[href*="profile.php"], h3 a[href*="profile.php"]');
        for (const link of headerLinks) {
          const rect = link.getBoundingClientRect();
          // Header is always above text
          if (rect.top < textY) {
            const text = (link as HTMLElement).innerText?.trim();
            const href = link.getAttribute('href') || '';
            if (text && text.length > 1 && text.length < 60) {
              authorName = text;
              if (!authorLink) authorLink = href;
              break;
            }
          }
        }
      }

      // STRATEGY 4: If still no photo, look for regular img at top of container
      if (!authorPhoto) {
        const images = el.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]');
        let topImg: { y: number; src: string } | null = null;

        for (const img of images) {
          const rect = img.getBoundingClientRect();
          const src = img.getAttribute('src');
          if (src && rect.top < textY) {
            if (!topImg || rect.top < topImg.y) {
              topImg = { y: rect.top, src };
            }
          }
        }

        if (topImg) {
          authorPhoto = topImg.src;
        }
      }

      // === USE ALREADY EXTRACTED POST TEXT ===
      // We already have the text in `postText` from the text-first approach
      // Just clean it up
      const finalText = postText
        .replace(/See more\.{0,3}$/gm, '')
        .replace(/See less\.{0,3}$/gm, '')
        .replace(/See translation$/gm, '')
        .replace(/See original$/gm, '')
        .replace(/ראה עוד\.{0,3}$/gm, '')
        .replace(/עוד\.{0,3}$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (finalText.length < 50) continue;

      // === EXTRACT POST URL ===
      // Use the pre-collected postUrlMap to find the closest unused URL
      // This ensures each unique URL is only assigned to ONE post
      let postUrl: string | null = null;
      // textY is already defined above from textItem.y

      // Strategy 1: Search in immediate container first (most reliable if found)
      const permalinkPatterns = [
        'a[href*="/posts/"]',
        'a[href*="/permalink/"]',
        'a[href*="story_fbid="]',
        'a[href*="pfbid"]',
      ];

      for (const pattern of permalinkPatterns) {
        const link = el.querySelector(pattern);
        if (link) {
          const href = link.getAttribute('href');
          if (href) {
            let cleanUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
            // Clean URL
            try {
              const url = new URL(cleanUrl, 'https://www.facebook.com');
              url.searchParams.delete('comment_id');
              url.searchParams.delete('reply_comment_id');
              url.searchParams.delete('__cft__[0]');
              url.searchParams.delete('__tn__');
              cleanUrl = url.toString();
            } catch {}
            // Extract post ID and mark as used in map
            const postIdMatch = cleanUrl.match(/\/posts\/(\d+)/);
            if (postIdMatch) {
              const mapEntry = postUrlMap.get(postIdMatch[1]);
              if (mapEntry && !mapEntry.used) {
                postUrl = cleanUrl;
                mapEntry.used = true;
                break;
              }
            }
            // If not in map, still use it
            if (!postUrl) {
              postUrl = cleanUrl;
              break;
            }
          }
        }
      }

      // Strategy 2: Search parent containers
      if (!postUrl) {
        let searchEl: Element | null = el;
        for (let level = 0; level < 8 && searchEl && !postUrl; level++) {
          searchEl = searchEl.parentElement;
          if (!searchEl || searchEl.getAttribute('role') === 'feed') break;

          const timestampLinks = searchEl.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="pfbid"]');
          for (const link of timestampLinks) {
            const href = link.getAttribute('href') || '';
            const text = (link as HTMLElement).innerText?.trim() || '';

            const isTimestamp = text.length < 15 && (
              text.match(/^\d+\s*[hdwmy]$/i) ||
              text.match(/^(just now|yesterday|today)/i)
            );

            if (isTimestamp || href.includes('/posts/')) {
              let cleanUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
              try {
                const url = new URL(cleanUrl, 'https://www.facebook.com');
                url.searchParams.delete('comment_id');
                url.searchParams.delete('reply_comment_id');
                url.searchParams.delete('__cft__[0]');
                url.searchParams.delete('__tn__');
                cleanUrl = url.toString();
              } catch {}

              const postIdMatch = cleanUrl.match(/\/posts\/(\d+)/);
              if (postIdMatch) {
                const mapEntry = postUrlMap.get(postIdMatch[1]);
                if (mapEntry && !mapEntry.used) {
                  postUrl = cleanUrl;
                  mapEntry.used = true;
                  break;
                }
              }
            }
          }
        }
      }

      // Strategy 3: Match by __cft__ parameter
      // All links within a Facebook post share the same __cft__ tracking parameter
      // Extract __cft__ from author link, then find post URLs with matching __cft__
      if (!postUrl && authorLink) {
        const cftMatch = authorLink.match(/__cft__\[0\]=([^&]+)/);
        if (cftMatch) {
          const authorCft = cftMatch[1];

          // Search ALL post URLs in the feed with matching __cft__
          const allPostLinks = feed.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
          for (const link of allPostLinks) {
            const href = link.getAttribute('href') || '';
            const linkCftMatch = href.match(/__cft__\[0\]=([^&]+)/);

            if (linkCftMatch && linkCftMatch[1] === authorCft) {
              // Found matching __cft__ - this post URL belongs to this post
              let cleanUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
              try {
                const url = new URL(cleanUrl, 'https://www.facebook.com');
                url.searchParams.delete('comment_id');
                url.searchParams.delete('reply_comment_id');
                url.searchParams.delete('__cft__[0]');
                url.searchParams.delete('__tn__');
                cleanUrl = url.toString();
              } catch {}

              postUrl = cleanUrl;
              break;
            }
          }
        }
      }

      // Strategy 4: Extract post ID from photo URLs in this container (set=pcb.XXXXX)
      // Photo posts have the post ID in the photo URL's set parameter
      if (!postUrl && groupId) {
        const photoLinksInContainer = el.querySelectorAll('a[href*="set=pcb."]');
        for (const link of photoLinksInContainer) {
          const href = link.getAttribute('href') || '';
          const pcbMatch = href.match(/set=pcb\.(\d+)/);
          if (pcbMatch) {
            const postId = pcbMatch[1];
            postUrl = `https://www.facebook.com/groups/${groupId}/posts/${postId}`;
            break;
          }
        }
      }

      // Strategy 5: Use postUrlMap to find closest UNUSED URL by proximity
      // Only match if URL is reasonably close (within 150px) and not yet used
      if (!postUrl) {
        let closestEntry: { postId: string; entry: { url: string; y: number; used: boolean } } | null = null;
        let closestDistance = 150; // Reduced from 200px for more precision

        for (const [postId, entry] of postUrlMap.entries()) {
          if (entry.used) continue; // Skip already used URLs

          const distance = Math.abs(entry.y - textY);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestEntry = { postId, entry };
          }
        }

        if (closestEntry) {
          postUrl = closestEntry.entry.url;
          closestEntry.entry.used = true;
        }
      }

      results.push({
        text: finalText,
        authorName,
        authorLink,
        authorPhoto,
        postUrl
      });

      // Limit to avoid too many posts
      if (results.length >= 30) break;
    }

    return results;
  });

  logger.info(`Feed children extraction found ${extractedPosts.length} potential posts`);

  for (const postData of extractedPosts) {
    // Skip duplicates
    const textHash = postData.text.substring(0, 100);
    if (seenTexts.has(textHash)) continue;
    seenTexts.add(textHash);

    // Try to get REAL post ID from multiple sources:
    // 1. From the post URL (most reliable - extracted from DOM)
    // 2. From intercepted GraphQL data
    // 3. Fallback to content hash
    let postId: string = '';

    // Priority 1: Extract from post URL (e.g., /posts/1234567890)
    if (postData.postUrl) {
      const urlPostIdMatch = postData.postUrl.match(/\/posts\/(\d+)/);
      if (urlPostIdMatch) {
        postId = urlPostIdMatch[1];
        logger.debug(`Extracted post ID from URL: ${postId}`);
      }
    }

    // Priority 2: Try intercepted GraphQL data
    if (!postId) {
      const interceptedId = getInterceptedPostId(postData.text);
      if (interceptedId) {
        postId = interceptedId;
        logger.debug(`Found intercepted post ID: ${postId}`);
      }
    }

    // Priority 3: Fallback to content hash
    if (!postId) {
      postId = `hash_${generateContentHash(postData.text, postData.authorLink || undefined)}`;
    }

    // Normalize author link
    const authorLink = postData.authorLink ? normalizeAuthorLink(postData.authorLink) : undefined;

    posts.push({
      fbPostId: postId,
      authorName: postData.authorName || undefined,
      authorLink,
      authorPhoto: postData.authorPhoto || undefined,
      text: postData.text,
      postUrl: postData.postUrl || undefined,
    });
  }

  logger.info(`Feed children extraction complete: Found ${posts.length} valid posts`);
  return posts;
};

/**
 * Alternative post extraction for groups with non-standard DOM structure
 * Used when role="article" containers are empty or missing
 *
 * This method uses a two-phase approach:
 * 1. First, collect ALL profile photos on the page with their y-positions
 * 2. Then, for each post text, find the nearest profile photo ABOVE it
 */
const extractPostsAlternative = async (page: Page): Promise<ScrapedPost[]> => {
  logger.info('Using alternative extraction method (div[dir="auto"])...');
  const posts: ScrapedPost[] = [];
  const seenTexts = new Set<string>();

  // Two-phase extraction for better photo matching
  const postTexts = await page.evaluate(() => {
    const results: Array<{
      text: string;
      authorName: string | null;
      authorLink: string | null;
      authorPhoto: string | null;
      postUrl: string | null;
    }> = [];

    // PHASE 1: Collect ALL profile photos on the page with their positions
    const profilePhotos: Array<{
      y: number;
      photo: string;
      link: string | null;
      name: string | null;
    }> = [];

    // Find all profile links that contain SVG images (Facebook's current structure)
    const profileLinks = document.querySelectorAll('a[href*="/user/"], a[href*="profile.php"], a[href*="/people/"]');
    for (const link of profileLinks) {
      const svgImage = link.querySelector('svg image');
      if (svgImage) {
        const href = svgImage.getAttribute('href') ||
                    svgImage.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                    svgImage.getAttribute('xlink:href');
        if (href && (href.includes('scontent') || href.includes('fbcdn'))) {
          const rect = link.getBoundingClientRect();
          const linkHref = link.getAttribute('href') || '';
          const name = (link as HTMLElement).innerText?.trim() ||
                      link.getAttribute('aria-label') || null;
          profilePhotos.push({
            y: rect.top,
            photo: href,
            link: linkHref,
            name: name && name.length > 1 && name.length < 50 ? name : null
          });
        }
      }
      // Also check for regular img inside profile links
      const img = link.querySelector('img[src*="scontent"], img[src*="fbcdn"]');
      if (img && !link.querySelector('svg image')) {
        const src = img.getAttribute('src');
        if (src) {
          const rect = link.getBoundingClientRect();
          const linkHref = link.getAttribute('href') || '';
          const name = (link as HTMLElement).innerText?.trim() ||
                      link.getAttribute('aria-label') || null;
          profilePhotos.push({
            y: rect.top,
            photo: src,
            link: linkHref,
            name: name && name.length > 1 && name.length < 50 ? name : null
          });
        }
      }
    }

    // Also scan for any SVG images that might not be in profile links
    const allSvgImages = document.querySelectorAll('svg image');
    for (const svgImg of allSvgImages) {
      const href = svgImg.getAttribute('href') ||
                  svgImg.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ||
                  svgImg.getAttribute('xlink:href');
      if (href && (href.includes('scontent') || href.includes('fbcdn'))) {
        // Check if we already have this photo
        if (!profilePhotos.some(p => p.photo === href)) {
          const rect = svgImg.getBoundingClientRect();
          // Try to find parent link
          let parentLink = svgImg.closest('a');
          let linkHref = parentLink ? parentLink.getAttribute('href') : null;
          let name = parentLink ? (parentLink.getAttribute('aria-label') || null) : null;
          profilePhotos.push({
            y: rect.top,
            photo: href,
            link: linkHref,
            name: name
          });
        }
      }
    }

    // Sort photos by y position
    profilePhotos.sort((a, b) => a.y - b.y);

    // PHASE 2: Find all post text content
    const dirAutoDivs = document.querySelectorAll('div[dir="auto"]');

    for (const div of dirAutoDivs) {
      const text = (div as HTMLElement).innerText || '';

      // Skip if too short or looks like UI element
      if (text.length < 50) continue;
      if (text.startsWith('Facebook')) continue;
      if (text.match(/^(Like|Comment|Share|Reply|See more|See translation)/)) continue;

      // Skip if it's just repeated "Facebook" text (placeholder images)
      if (text.replace(/Facebook/g, '').trim().length < 30) continue;

      // Clean the text
      const cleanedText = text
        .replace(/See more\.\.\.$/gm, '')
        .replace(/See translation$/gm, '')
        .replace(/See original$/gm, '')
        .replace(/Rate this translation$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (cleanedText.length < 40) continue;

      // Get the y position of this text
      const divRect = div.getBoundingClientRect();
      const divY = divRect.top;

      // Find the nearest profile photo ABOVE this text (within 300px)
      let authorName: string | null = null;
      let authorLink: string | null = null;
      let authorPhoto: string | null = null;

      // Find the closest photo ABOVE the text (author photo is always above)
      // IMPORTANT: Only match photos that are above the text, not below
      let closestPhoto = null;
      let closestDistance = Infinity;
      for (const photo of profilePhotos) {
        // Photo MUST be above the text (photo.y < divY)
        // And within 150px distance (tighter threshold to avoid wrong matches)
        const distance = divY - photo.y;
        if (distance > 0 && distance < 150 && distance < closestDistance) {
          // Verify this photo has a valid profile link (not just any image)
          if (photo.link && (photo.link.includes('/user/') || photo.link.includes('profile.php'))) {
            closestDistance = distance;
            closestPhoto = photo;
          }
        }
      }

      if (closestPhoto) {
        authorPhoto = closestPhoto.photo;
        authorLink = closestPhoto.link;
        authorName = closestPhoto.name;
      }

      // FALLBACK: Only search for author in PARENT elements if they're ABOVE the text
      // This prevents picking up mentioned users in the post content
      if (!authorLink) {
        let parent = div.parentElement;
        for (let i = 0; i < 5 && parent; i++) {
          // Only search if parent is above the text position
          const parentRect = parent.getBoundingClientRect();
          if (parentRect.top >= divY) {
            parent = parent.parentElement;
            continue; // Skip elements at or below text position
          }

          // Look for profile photo links (not just any profile link)
          const photoLinks = parent.querySelectorAll('a[href*="/user/"] svg image, a[href*="profile.php"] svg image');
          for (const photoImg of photoLinks) {
            const link = photoImg.closest('a');
            if (link) {
              const href = link.getAttribute('href') || '';
              const name = link.getAttribute('aria-label') ||
                          (link as HTMLElement).innerText?.trim() || null;
              if (name && name.length > 1 && name.length < 50) {
                authorName = name;
                authorLink = href;
                break;
              }
            }
          }
          if (authorLink) break;
          parent = parent.parentElement;
        }
      }

      // Extract post URL from ancestor elements AND by proximity
      let postUrl: string | null = null;

      // Strategy 1: Search ancestor elements
      let parent = div.parentElement;
      for (let i = 0; i < 15 && parent; i++) {
        const permalinks = parent.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="], a[href*="pfbid"]');
        for (const link of permalinks) {
          const href = link.getAttribute('href');
          if (href) {
            postUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
            break;
          }
        }
        if (postUrl) break;
        parent = parent.parentElement;
      }

      // Strategy 2: Search by proximity - find nearest timestamp/post link
      if (!postUrl) {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) {
          const allPostLinks = feed.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
          let closestLink: Element | null = null;
          let closestDistance = 200; // Max 200px

          for (const link of allPostLinks) {
            const linkRect = link.getBoundingClientRect();
            const distance = Math.abs(linkRect.top - divY);

            if (distance < closestDistance) {
              closestDistance = distance;
              closestLink = link;
            }
          }

          if (closestLink) {
            const href = closestLink.getAttribute('href');
            if (href) {
              postUrl = href.startsWith('/') ? `https://www.facebook.com${href}` : href;
            }
          }
        }
      }

      // Clean post URL
      if (postUrl) {
        try {
          const url = new URL(postUrl, 'https://www.facebook.com');
          url.searchParams.delete('comment_id');
          url.searchParams.delete('reply_comment_id');
          url.searchParams.delete('__cft__[0]');
          url.searchParams.delete('__tn__');
          postUrl = url.toString();
        } catch {}
      }

      results.push({
        text: cleanedText,
        authorName,
        authorLink,
        authorPhoto,
        postUrl
      });

      // Limit results
      if (results.length >= 30) break;
    }

    return results;
  });

  logger.info(`Alternative extraction found ${postTexts.length} potential posts`);

  for (const postData of postTexts) {
    // Skip duplicates (same text content)
    const textHash = postData.text.substring(0, 100);
    if (seenTexts.has(textHash)) continue;
    seenTexts.add(textHash);

    // Try to get REAL post ID from multiple sources:
    let postId: string = '';

    // Priority 1: Extract from post URL
    if (postData.postUrl) {
      const urlPostIdMatch = postData.postUrl.match(/\/posts\/(\d+)/);
      if (urlPostIdMatch) {
        postId = urlPostIdMatch[1];
        logger.debug(`Extracted post ID from URL: ${postId}`);
      }
    }

    // Priority 2: Try intercepted GraphQL data
    if (!postId) {
      const interceptedId = getInterceptedPostId(postData.text);
      if (interceptedId) {
        postId = interceptedId;
        logger.debug(`Found intercepted post ID: ${postId}`);
      }
    }

    // Priority 3: Fallback to content hash
    if (!postId) {
      postId = `hash_${generateContentHash(postData.text, postData.authorLink || undefined)}`;
    }

    // Normalize author link
    const authorLink = postData.authorLink ? normalizeAuthorLink(postData.authorLink) : undefined;

    posts.push({
      fbPostId: postId,
      authorName: postData.authorName || undefined,
      authorLink,
      authorPhoto: postData.authorPhoto || undefined,
      text: postData.text,
      postUrl: postData.postUrl || undefined,
    });
  }

  logger.info(`Alternative extraction complete: Found ${posts.length} valid posts`);
  return posts;
};
