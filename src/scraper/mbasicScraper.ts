/**
 * MBasic Facebook Scraper
 *
 * This scraper uses mbasic.facebook.com which is Facebook's lightweight
 * mobile version. Key advantages:
 * - Plain HTML (no JavaScript rendering needed)
 * - Much faster than browser-based scraping
 * - Harder to detect as automated
 * - Lower resource usage
 *
 * Works with the same Facebook session cookies as Playwright.
 */

import axios, { AxiosInstance } from 'axios';
import { createHash } from 'crypto';
import logger from '../utils/logger';
import { NormalizedPost } from './apifyScraper';
import { loadCookies } from '../facebook/session';

// MBasic Facebook URLs
const MBASIC_BASE_URL = 'https://mbasic.facebook.com';

// User agent that mimics a basic mobile browser
const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';

// Alternative user agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 10; SM-G960F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
];

interface MBasicPost {
  fbPostId: string;
  authorName: string | null;
  authorLink: string | null;
  text: string;
  postUrl: string | null;
}

/**
 * Generate a deterministic hash-based ID for posts without explicit IDs
 */
const generatePostId = (text: string, authorName: string | null): string => {
  const content = `${text}|${authorName || ''}`;
  return `mbasic_${createHash('sha256').update(content).digest('hex').substring(0, 24)}`;
};

/**
 * Convert saved cookies to axios cookie header format
 */
const getCookieHeader = async (): Promise<string | null> => {
  try {
    const cookies = await loadCookies();
    if (!cookies || cookies.length === 0) {
      return null;
    }

    // Filter for Facebook cookies and format them
    const fbCookies = cookies
      .filter(c => c.domain.includes('facebook.com'))
      .map(c => `${c.name}=${c.value}`)
      .join('; ');

    return fbCookies || null;
  } catch (error) {
    logger.error(`[MBasic] Failed to load cookies: ${(error as Error).message}`);
    return null;
  }
};

/**
 * Create an axios instance configured for mbasic.facebook.com
 */
const createMBasicClient = async (): Promise<AxiosInstance | null> => {
  const cookieHeader = await getCookieHeader();

  if (!cookieHeader) {
    logger.warn('[MBasic] No valid cookies found. Cannot authenticate.');
    return null;
  }

  // Check if we have the critical session cookies
  if (!cookieHeader.includes('c_user=') || !cookieHeader.includes('xs=')) {
    logger.warn('[MBasic] Missing critical session cookies (c_user or xs)');
    return null;
  }

  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  return axios.create({
    baseURL: MBASIC_BASE_URL,
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5,he;q=0.3',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Cookie': cookieHeader,
      'Cache-Control': 'max-age=0',
    },
    timeout: 30000,
    maxRedirects: 5,
    validateStatus: (status) => status < 500, // Don't throw on 4xx
  });
};

/**
 * Extract post ID from mbasic HTML
 * MBasic uses different URL patterns than regular Facebook
 */
const extractPostId = (postHtml: string, permalink: string | null): string | null => {
  // Try to extract from permalink
  if (permalink) {
    // Pattern: /groups/123456/permalink/789012/
    const permalinkMatch = permalink.match(/\/permalink\/(\d+)/);
    if (permalinkMatch) {
      return permalinkMatch[1];
    }

    // Pattern: /story.php?story_fbid=123456
    const storyMatch = permalink.match(/story_fbid=(\d+)/);
    if (storyMatch) {
      return storyMatch[1];
    }

    // Pattern: pfbid format
    const pfbidMatch = permalink.match(/pfbid[A-Za-z0-9]+/);
    if (pfbidMatch) {
      return pfbidMatch[0];
    }
  }

  // Try to extract from post HTML data attributes
  const dataFtMatch = postHtml.match(/data-ft="([^"]+)"/);
  if (dataFtMatch) {
    try {
      const decoded = dataFtMatch[1].replace(/&quot;/g, '"');
      const parsed = JSON.parse(decoded);
      if (parsed.mf_story_key) return parsed.mf_story_key;
      if (parsed.top_level_post_id) return parsed.top_level_post_id;
    } catch {
      // JSON parse failed, continue
    }
  }

  return null;
};

/**
 * Extract author name from post HTML
 */
const extractAuthorName = (postHtml: string): string | null => {
  // MBasic structure: <strong class="actor"><a href="...">Author Name</a></strong>
  const actorMatch = postHtml.match(/<strong[^>]*class="[^"]*actor[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
  if (actorMatch) {
    return actorMatch[1].trim();
  }

  // Alternative: <h3><a href="...">Author Name</a></h3>
  const h3Match = postHtml.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
  if (h3Match) {
    return h3Match[1].trim();
  }

  // Another pattern: data-sigil="actor-link"
  const sigilMatch = postHtml.match(/data-sigil="[^"]*actor[^"]*"[^>]*>([^<]+)</i);
  if (sigilMatch) {
    return sigilMatch[1].trim();
  }

  return null;
};

/**
 * Extract author profile link from post HTML
 */
const extractAuthorLink = (postHtml: string): string | null => {
  // MBasic structure: <strong class="actor"><a href="/profile.php?id=123">
  const actorLinkMatch = postHtml.match(/<strong[^>]*class="[^"]*actor[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i);
  if (actorLinkMatch) {
    const href = actorLinkMatch[1];
    return normalizeAuthorLink(href);
  }

  // Alternative: h3 > a pattern
  const h3LinkMatch = postHtml.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i);
  if (h3LinkMatch) {
    const href = h3LinkMatch[1];
    return normalizeAuthorLink(href);
  }

  return null;
};

/**
 * Normalize an author link to full Facebook URL
 */
const normalizeAuthorLink = (href: string): string | null => {
  if (!href) return null;

  // Decode HTML entities
  href = href.replace(/&amp;/g, '&');

  // Handle relative URLs
  if (href.startsWith('/')) {
    href = `https://www.facebook.com${href}`;
  }

  try {
    const url = new URL(href);

    // Extract user ID from profile.php
    if (url.pathname.includes('/profile.php')) {
      const id = url.searchParams.get('id');
      if (id) {
        return `https://www.facebook.com/profile.php?id=${id}`;
      }
    }

    // Handle /user/ID format
    const userMatch = url.pathname.match(/\/user\/(\d+)/);
    if (userMatch) {
      return `https://www.facebook.com/profile.php?id=${userMatch[1]}`;
    }

    // Handle username format
    const usernameMatch = url.pathname.match(/^\/([a-zA-Z0-9.]+)\/?$/);
    if (usernameMatch) {
      return `https://www.facebook.com/${usernameMatch[1]}`;
    }

    return href;
  } catch {
    return null;
  }
};

/**
 * Extract "See More" link from post HTML if text is truncated
 */
const extractSeeMoreLink = (postHtml: string): string | null => {
  // MBasic uses various patterns for "See More" links
  // Pattern 1: <a href="...">See More</a> or similar text
  const seeMorePatterns = [
    /href="([^"]+)"[^>]*>\s*See [Mm]ore\s*</i,
    /href="([^"]+)"[^>]*>\s*\.\.\.more\s*</i,
    /href="([^"]+)"[^>]*>\s*ראה עוד\s*</i,  // Hebrew
    /href="([^"]+)"[^>]*>\s*عرض المزيد\s*</i, // Arabic
    /<a[^>]*href="([^"]*story\.php[^"]*)"[^>]*>.*<\/a>/i,
  ];

  for (const pattern of seeMorePatterns) {
    const match = postHtml.match(pattern);
    if (match && match[1]) {
      return match[1].replace(/&amp;/g, '&');
    }
  }

  // Check if text appears truncated (ends with ...)
  if (postHtml.includes('...') || postHtml.includes('…')) {
    // Try to find any link that might lead to full post
    const storyLinkMatch = postHtml.match(/href="([^"]*(?:story\.php|permalink)[^"]*)"/i);
    if (storyLinkMatch) {
      return storyLinkMatch[1].replace(/&amp;/g, '&');
    }
  }

  return null;
};

/**
 * Extract post text from HTML - ENHANCED with full text support
 */
const extractPostText = (postHtml: string): string | null => {
  let text = '';

  // MBasic post text is usually in a <p> or <div> after the story header
  // Pattern 1: <div class="... story_body_container ..."><p>text</p></div>
  const storyBodyMatch = postHtml.match(/class="[^"]*story_body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (storyBodyMatch) {
    text = cleanHtmlText(storyBodyMatch[1]);
  }

  // Pattern 2: <p> tags with significant content
  if (!text || text.length < 20) {
    const paragraphs = postHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/gi);
    if (paragraphs) {
      for (const p of paragraphs) {
        const textMatch = p.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (textMatch) {
          const candidate = cleanHtmlText(textMatch[1]);
          if (candidate && candidate.length > text.length) {
            text = candidate;
          }
        }
      }
    }
  }

  // Pattern 3: data-ft containing content
  if (!text || text.length < 20) {
    const contentDivMatch = postHtml.match(/<div[^>]*data-ft[^>]*>([\s\S]*?)<\/div>/i);
    if (contentDivMatch) {
      const candidate = cleanHtmlText(contentDivMatch[1]);
      if (candidate && candidate.length > text.length) {
        text = candidate;
      }
    }
  }

  // Pattern 4: Look for all text content in the post body
  if (!text || text.length < 20) {
    // Find the main content area and get all text
    const mainContentMatch = postHtml.match(/<div[^>]*class="[^"]*(?:_5pbx|_2vj0|story)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (mainContentMatch) {
      const candidate = cleanHtmlText(mainContentMatch[1]);
      if (candidate && candidate.length > text.length) {
        text = candidate;
      }
    }
  }

  // Clean up any truncation artifacts
  if (text) {
    text = text
      .replace(/\s*See [Mm]ore\s*$/i, '')
      .replace(/\s*\.\.\.more\s*$/i, '')
      .replace(/\s*ראה עוד\s*$/i, '')
      .replace(/\s*عرض المزيد\s*$/i, '')
      .trim();
  }

  return text || null;
};

/**
 * Clean HTML and extract plain text
 */
const cleanHtmlText = (html: string): string => {
  if (!html) return '';

  return html
    // Remove HTML tags but keep line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Fetch full post text from a "See More" link
 * MBasic's "See More" links go to a page with the full post content
 */
const fetchFullPostText = async (client: AxiosInstance, seeMoreUrl: string): Promise<string | null> => {
  try {
    // Handle relative URLs
    const fullUrl = seeMoreUrl.startsWith('/') ? seeMoreUrl : `/${seeMoreUrl}`;

    logger.debug(`[MBasic] Fetching full text from: ${fullUrl}`);
    const response = await client.get(fullUrl);

    if (response.status !== 200) {
      return null;
    }

    const html = response.data as string;

    // On the full post page, the text is usually in a cleaner format
    // Try multiple extraction patterns

    // Pattern 1: Story body container
    let text = '';
    const storyBodyMatch = html.match(/class="[^"]*story_body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (storyBodyMatch) {
      text = cleanHtmlText(storyBodyMatch[1]);
    }

    // Pattern 2: Main post content area
    if (!text || text.length < 30) {
      const mainMatch = html.match(/<div[^>]*class="[^"]*_5pbx[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (mainMatch) {
        const candidate = cleanHtmlText(mainMatch[1]);
        if (candidate.length > text.length) {
          text = candidate;
        }
      }
    }

    // Pattern 3: Post message content
    if (!text || text.length < 30) {
      const messageMatch = html.match(/<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      if (messageMatch) {
        const candidate = cleanHtmlText(messageMatch[1]);
        if (candidate.length > text.length) {
          text = candidate;
        }
      }
    }

    // Pattern 4: Get all paragraph content
    if (!text || text.length < 30) {
      const paragraphs = html.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
      let allParagraphs = '';
      for (const p of paragraphs) {
        const pText = cleanHtmlText(p);
        if (pText && pText.length > 10) {
          allParagraphs += pText + '\n';
        }
      }
      if (allParagraphs.length > text.length) {
        text = allParagraphs.trim();
      }
    }

    if (text && text.length > 30) {
      logger.debug(`[MBasic] Got full text: ${text.length} chars`);
      return text;
    }

    return null;
  } catch (error) {
    logger.debug(`[MBasic] Failed to fetch full text: ${(error as Error).message}`);
    return null;
  }
};

/**
 * Extract permalink from post HTML
 */
const extractPermalink = (postHtml: string): string | null => {
  // Pattern: <a href="/groups/.../permalink/...">
  const permalinkMatch = postHtml.match(/href="([^"]*\/permalink\/[^"]+)"/i);
  if (permalinkMatch) {
    return permalinkMatch[1];
  }

  // Pattern: <a href="/story.php?...">
  const storyMatch = postHtml.match(/href="([^"]*\/story\.php[^"]+)"/i);
  if (storyMatch) {
    return storyMatch[1];
  }

  return null;
};

/**
 * Parse posts from MBasic group page HTML
 * Handles both true mbasic HTML and redirected modern Facebook HTML
 * ENHANCED: Now supports fetching full text from "See More" links
 */
const parseGroupPosts = async (
  html: string,
  groupId: string,
  client?: AxiosInstance | null
): Promise<MBasicPost[]> => {
  const posts: MBasicPost[] = [];

  // Detect if we got modern Facebook HTML (redirect happened)
  const isModernFacebook = html.includes('data-pagelet') || html.includes('role="feed"');

  if (isModernFacebook) {
    logger.info('[MBasic] Detected modern Facebook HTML (redirect occurred)');
    // For modern Facebook, we need different parsing
    // This is less reliable but can still extract some posts

    // Pattern 1: Try to find post permalinks and extract IDs
    const permalinkMatches = html.match(/\/groups\/[^/]+\/permalink\/(\d+)/g) || [];
    const postIds = [...new Set(permalinkMatches.map(m => {
      const match = m.match(/permalink\/(\d+)/);
      return match ? match[1] : null;
    }).filter(Boolean))];

    logger.info(`[MBasic] Found ${postIds.length} post IDs from permalinks`);

    // For modern FB, we can't easily extract post text via HTTP
    // Return empty and let Playwright handle it
    return posts;
  }

  // True MBasic HTML parsing
  // MBasic wraps each post in an article tag or div with specific classes
  // Pattern 1: <article> tags
  const articleMatches = html.match(/<article[^>]*>[\s\S]*?<\/article>/gi) || [];

  // Pattern 2: div with story class
  const storyDivMatches = html.match(/<div[^>]*class="[^"]*story[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*class="[^"]*story[^"]*"|$)/gi) || [];

  // Pattern 3: div with data-ft attribute (Facebook tracking)
  const dataFtMatches = html.match(/<div[^>]*data-ft="[^"]*mf_story_key[^"]*"[^>]*>[\s\S]*?(?=<div[^>]*data-ft="|$)/gi) || [];

  // Pattern 4: MBasic specific - div with id containing "post"
  const postIdDivMatches = html.match(/<div[^>]*id="[^"]*post[^"]*"[^>]*>[\s\S]*?<\/div>/gi) || [];

  // Combine all matches
  const allMatches = [...articleMatches, ...storyDivMatches, ...dataFtMatches, ...postIdDivMatches];

  logger.info(`[MBasic] Found ${allMatches.length} potential post containers`);

  const seenIds = new Set<string>();

  for (const postHtml of allMatches) {
    try {
      const permalink = extractPermalink(postHtml);
      let text = extractPostText(postHtml);

      if (!text || text.length < 20) {
        continue;
      }

      const authorName = extractAuthorName(postHtml);
      const authorLink = extractAuthorLink(postHtml);

      // ENHANCED: Check if text appears truncated and fetch full text
      const isTruncated = text.endsWith('...') ||
                          text.endsWith('…') ||
                          text.includes('See more') ||
                          text.includes('ראה עוד') ||
                          text.includes('عرض المزيد');

      if (isTruncated && client) {
        const seeMoreLink = extractSeeMoreLink(postHtml);
        if (seeMoreLink) {
          logger.debug(`[MBasic] Text appears truncated, fetching full text...`);
          const fullText = await fetchFullPostText(client, seeMoreLink);
          if (fullText && fullText.length > text.length) {
            logger.info(`[MBasic] Got full text: ${text.length} -> ${fullText.length} chars`);
            text = fullText;
          }
        } else if (permalink) {
          // Try using permalink as fallback
          logger.debug(`[MBasic] Trying permalink for full text...`);
          const fullText = await fetchFullPostText(client, permalink);
          if (fullText && fullText.length > text.length) {
            logger.info(`[MBasic] Got full text from permalink: ${text.length} -> ${fullText.length} chars`);
            text = fullText;
          }
        }
      }

      // Clean up any remaining truncation artifacts
      text = text
        .replace(/\s*See [Mm]ore\s*$/i, '')
        .replace(/\s*\.\.\.more\s*$/i, '')
        .replace(/…\s*$/i, '')
        .trim();

      let fbPostId = extractPostId(postHtml, permalink);
      if (!fbPostId) {
        fbPostId = generatePostId(text, authorName);
      }

      // Skip duplicates
      if (seenIds.has(fbPostId)) {
        continue;
      }
      seenIds.add(fbPostId);

      // Construct post URL from permalink or groupId/postId
      let postUrl: string | null = null;
      if (permalink) {
        postUrl = permalink.startsWith('/') ? `https://mbasic.facebook.com${permalink}` : permalink;
        // Convert mbasic URL to regular Facebook URL for better compatibility
        postUrl = postUrl.replace('mbasic.facebook.com', 'www.facebook.com');
      } else if (fbPostId && !fbPostId.startsWith('mbasic_')) {
        postUrl = `https://www.facebook.com/groups/${groupId}/posts/${fbPostId}`;
      }

      posts.push({
        fbPostId,
        authorName,
        authorLink,
        text,
        postUrl,
      });

    } catch (error) {
      logger.debug(`[MBasic] Failed to parse post: ${(error as Error).message}`);
    }
  }

  return posts;
};

/**
 * Check if the response indicates we need to log in
 */
const isLoginRequired = (html: string): boolean => {
  // Check for login form indicators
  const loginIndicators = [
    'name="email"',
    'name="pass"',
    'id="login_form"',
    '/login.php',
    'Log In</button>',
    'Create New Account',
  ];

  return loginIndicators.some(indicator => html.includes(indicator));
};

/**
 * Check if we're blocked or rate limited
 */
const isBlocked = (html: string): boolean => {
  const blockIndicators = [
    'temporarily blocked',
    'suspicious activity',
    'try again later',
    'security check',
    'checkpoint',
  ];

  const lowerHtml = html.toLowerCase();
  return blockIndicators.some(indicator => lowerHtml.includes(indicator));
};

/**
 * Scrape a Facebook group using mbasic.facebook.com
 *
 * @param groupId - The Facebook group ID to scrape
 * @returns Array of normalized posts
 */
export const scrapeGroupWithMBasic = async (groupId: string): Promise<NormalizedPost[]> => {
  logger.info(`[MBasic] Starting scrape for group ${groupId}`);

  const client = await createMBasicClient();
  if (!client) {
    logger.error('[MBasic] Failed to create HTTP client (no valid session)');
    return [];
  }

  try {
    // First, fetch the group page
    const groupUrl = `/groups/${groupId}`;
    logger.info(`[MBasic] Fetching ${groupUrl}`);

    const response = await client.get(groupUrl);

    if (response.status === 404) {
      logger.warn(`[MBasic] Group ${groupId} not found (404)`);
      return [];
    }

    if (response.status >= 400) {
      logger.warn(`[MBasic] HTTP ${response.status} for group ${groupId}`);
      return [];
    }

    const html = response.data as string;

    // Check if login is required
    if (isLoginRequired(html)) {
      logger.warn('[MBasic] Session expired - login required');
      return [];
    }

    // Check if blocked
    if (isBlocked(html)) {
      logger.error('[MBasic] Account appears to be blocked or rate limited');
      return [];
    }

    // Check if we can access the group
    if (html.includes('Join Group') || html.includes('Request to Join')) {
      logger.warn(`[MBasic] Not a member of group ${groupId}`);
      return [];
    }

    // Parse posts from the HTML (ENHANCED: now fetches full text for truncated posts)
    const posts = await parseGroupPosts(html, groupId, client);
    logger.info(`[MBasic] Parsed ${posts.length} posts from initial page`);

    // If we got few posts, try to load more by following "See More Posts" link
    if (posts.length < 10) {
      const seeMoreMatch = html.match(/href="([^"]*see_more_posts[^"]*|[^"]*groupCurationFeedUnit[^"]*)"/i);
      if (seeMoreMatch) {
        try {
          logger.info('[MBasic] Loading more posts...');
          const moreUrl = seeMoreMatch[1].replace(/&amp;/g, '&');
          const moreResponse = await client.get(moreUrl);

          if (moreResponse.status === 200) {
            const morePosts = await parseGroupPosts(moreResponse.data as string, groupId, client);
            logger.info(`[MBasic] Parsed ${morePosts.length} additional posts`);

            // Add new posts (avoiding duplicates)
            const existingIds = new Set(posts.map(p => p.fbPostId));
            for (const post of morePosts) {
              if (!existingIds.has(post.fbPostId)) {
                posts.push(post);
              }
            }
          }
        } catch (moreError) {
          logger.warn(`[MBasic] Failed to load more posts: ${(moreError as Error).message}`);
        }
      }
    }

    // Convert to NormalizedPost format
    const normalizedPosts: NormalizedPost[] = posts.map(post => ({
      fbPostId: post.fbPostId,
      groupId: groupId,
      authorName: post.authorName,
      authorLink: post.authorLink,
      authorPhoto: null, // MBasic doesn't provide high-quality profile photos easily
      text: post.text,
      postUrl: post.postUrl,
    }));

    logger.info(`[MBasic] Successfully scraped ${normalizedPosts.length} posts from group ${groupId}`);
    return normalizedPosts;

  } catch (error) {
    const errorMessage = (error as Error).message;
    logger.error(`[MBasic] Scrape failed for group ${groupId}: ${errorMessage}`);

    // Check for specific error types
    if (errorMessage.includes('timeout')) {
      logger.warn('[MBasic] Request timed out - Facebook may be slow');
    } else if (errorMessage.includes('ECONNREFUSED')) {
      logger.warn('[MBasic] Connection refused - check network');
    }

    return [];
  }
};

/**
 * Check if MBasic scraping is available (has valid session)
 */
export const isMBasicAvailable = async (): Promise<boolean> => {
  const cookieHeader = await getCookieHeader();
  return cookieHeader !== null &&
         cookieHeader.includes('c_user=') &&
         cookieHeader.includes('xs=');
};
