/**
 * Apify-based Facebook Group Scraper
 *
 * This module replaces the Playwright-based scraper with Apify's Facebook Posts Scraper.
 * Benefits:
 * - No browser session management or cookie issues
 * - No bot detection problems
 * - Structured JSON output
 * - More reliable and scalable
 */

import { ApifyClient } from 'apify-client';
import logger from '../utils/logger';
import { apifyCircuitBreaker } from '../utils/circuitBreaker';

// Apify Actor for Facebook scraping
const FACEBOOK_SCRAPER_ACTOR = 'apify/facebook-posts-scraper';

// Default results limit (configurable via env)
const DEFAULT_RESULTS_LIMIT = Number(process.env.APIFY_RESULTS_LIMIT) || 20;

/**
 * Raw post data returned by Apify's Facebook scraper
 * Note: Apify uses different field names than what we might expect:
 * - 'id' instead of 'postId'
 * - 'message' instead of 'text'
 * - 'url' instead of 'postUrl'
 */
export interface ApifyFacebookPost {
  // Apify's actual field names
  id?: string;
  message?: string;
  url?: string;

  // Legacy/alternative field names (for compatibility)
  postId?: string;
  postUrl?: string;
  text?: string;

  // Author fields - Apify returns nested 'author' object
  author?: {
    name?: string;
    url?: string;
    profilePicture?: string;
    id?: string;
  };

  // Alternative author fields (flat structure)
  pageName?: string;
  pageUrl?: string;
  userName?: string;
  userUrl?: string;
  userProfilePicture?: string;
  profilePicture?: string;

  // Timestamps
  timestamp?: string;
  time?: string;
  date?: string;

  // Engagement metrics
  likes?: number;
  comments?: number;
  shares?: number;
  reactions?: number;

  // Media
  media?: Array<{
    type: string;
    url: string;
  }>;
  images?: string[];
  video?: string;

  // Additional fields that may be present
  [key: string]: unknown;
}

/**
 * Normalized post structure matching our database schema
 */
export interface NormalizedPost {
  fbPostId: string;
  groupId: string;
  authorName: string | null;
  authorLink: string | null;
  authorPhoto: string | null;
  text: string;
}

/**
 * Get Apify client instance
 * Throws if APIFY_TOKEN is not configured
 */
const getApifyClient = (): ApifyClient => {
  const token = process.env.APIFY_TOKEN;

  if (!token) {
    throw new Error('APIFY_TOKEN environment variable is not set. Cannot use Apify scraper.');
  }

  return new ApifyClient({ token });
};

/**
 * Normalize author link to a consistent format
 */
const normalizeAuthorLink = (url: string | undefined | null): string | null => {
  if (!url) return null;

  try {
    const parsed = new URL(url, 'https://www.facebook.com');

    // Handle /user/ID format
    const userMatch = parsed.pathname.match(/\/user\/(\d+)/);
    if (userMatch) {
      return `https://www.facebook.com/profile.php?id=${userMatch[1]}`;
    }

    // Handle profile.php?id=X
    if (parsed.pathname.includes('/profile.php')) {
      const id = parsed.searchParams.get('id');
      if (id) {
        return `https://www.facebook.com/profile.php?id=${id}`;
      }
    }

    // Handle /people/Name/ID format
    const peopleMatch = parsed.pathname.match(/\/people\/[^/]+\/(\d+)/);
    if (peopleMatch) {
      return `https://www.facebook.com/profile.php?id=${peopleMatch[1]}`;
    }

    // Handle /groups/groupid/user/userid
    const groupUserMatch = parsed.pathname.match(/\/groups\/[^/]+\/user\/(\d+)/);
    if (groupUserMatch) {
      return `https://www.facebook.com/profile.php?id=${groupUserMatch[1]}`;
    }

    // Handle username format (/username)
    const usernameMatch = parsed.pathname.match(/^\/([a-zA-Z0-9._-]+)\/?$/);
    if (usernameMatch) {
      const username = usernameMatch[1];
      const excludedPaths = [
        'groups', 'pages', 'events', 'watch', 'marketplace',
        'gaming', 'stories', 'reels', 'hashtag', 'search'
      ];
      if (!excludedPaths.includes(username.toLowerCase())) {
        return `https://www.facebook.com/${username}`;
      }
    }

    // Return cleaned URL if it looks like a profile
    if (parsed.hostname.includes('facebook.com')) {
      return url;
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Clean text by removing Facebook's "See more" truncation artifacts
 */
const cleanPostText = (text: string): string => {
  if (!text) return '';

  // Remove various "See more" patterns that Facebook adds to truncated posts
  // These patterns appear in different languages and formats
  let cleaned = text
    .replace(/…\s*See more\s*$/i, '')
    .replace(/\.\.\.\s*See more\s*$/i, '')
    .replace(/…\s*عرض المزيد\s*$/i, '')  // Arabic "See more"
    .replace(/…\s*ראה עוד\s*$/i, '')     // Hebrew "See more"
    .replace(/\s*See more\s*$/i, '')
    .trim();

  return cleaned;
};

/**
 * Extract post ID from Apify response
 * Apify uses 'id' field, but we also check 'postId' for compatibility
 * Also handles extracting ID from URL if needed
 */
const extractPostId = (post: ApifyFacebookPost): string | null => {
  // Try direct ID fields first
  if (post.id) return post.id;
  if (post.postId) return post.postId;

  // Try to extract from URL
  const url = post.url || post.postUrl;
  if (url) {
    // Pattern: /posts/123456789 or /permalink/123456789 or ?story_fbid=123456789
    const patterns = [
      /\/posts\/(\d+)/,
      /\/permalink\/(\d+)/,
      /story_fbid=(\d+)/,
      /\/(\d+)\/?$/,
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
  }

  return null;
};

/**
 * Extract post text from Apify response
 * Apify uses 'message' field, but we also check 'text' for compatibility
 */
const extractPostText = (post: ApifyFacebookPost): string | null => {
  // Try Apify's 'message' field first (this is what they actually use)
  if (post.message?.trim()) return post.message.trim();

  // Fallback to 'text' field
  if (post.text?.trim()) return post.text.trim();

  // Try other possible field names
  const altFields = ['content', 'body', 'description'] as const;
  for (const field of altFields) {
    const value = (post as Record<string, unknown>)[field];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
};

/**
 * Normalize a single Apify post to our database format
 */
const normalizePost = (post: ApifyFacebookPost, groupId: string): NormalizedPost | null => {
  // Log raw post data for debugging
  logger.debug(`Raw Apify post keys: ${Object.keys(post).join(', ')}`);
  logger.debug(`Raw Apify post sample: ${JSON.stringify(post).substring(0, 500)}`);

  // Extract post ID (handles both 'id' and 'postId' fields)
  const postId = extractPostId(post);

  // Extract text (handles both 'message' and 'text' fields)
  const postText = extractPostText(post);

  // Skip posts without ID or text
  if (!postId || !postText) {
    logger.info(`Skipping post - postId: ${postId}, hasText: ${Boolean(postText)}, keys: ${Object.keys(post).join(', ')}`);
    // Log a sample of the raw data at info level to help debug field mapping issues
    if (!postId || !postText) {
      logger.info(`Raw post sample for debugging: ${JSON.stringify(post).substring(0, 400)}`);
    }
    return null;
  }

  // Extract author info - try nested 'author' object first (Apify format), then flat fields
  const authorName = post.author?.name || post.userName || post.pageName || null;
  const authorLink = normalizeAuthorLink(post.author?.url || post.userUrl || post.pageUrl);

  // Extract profile picture - try multiple possible field names and nested author
  const authorPhoto = post.author?.profilePicture ||
    post.userProfilePicture ||
    post.profilePicture ||
    (post as Record<string, unknown>).userPicture as string ||
    (post as Record<string, unknown>).authorPicture as string ||
    (post as Record<string, unknown>).profilePic as string ||
    null;

  // Clean the text from "See more" artifacts
  const cleanedText = cleanPostText(postText);

  logger.debug(`Normalized post ${postId}: author=${authorName}, textLen=${cleanedText.length}`);

  return {
    fbPostId: postId,
    groupId,
    authorName,
    authorLink,
    authorPhoto,
    text: cleanedText,
  };
};

/**
 * Scrape a Facebook group using Apify's Facebook Posts Scraper
 *
 * @param groupId - The Facebook group ID to scrape
 * @param resultsLimit - Maximum number of posts to fetch (default: 20)
 * @returns Array of normalized posts ready for database insertion
 */
export const scrapeGroupWithApify = async (
  groupId: string,
  resultsLimit: number = DEFAULT_RESULTS_LIMIT
): Promise<NormalizedPost[]> => {
  // Check circuit breaker before attempting
  if (apifyCircuitBreaker.isOpen()) {
    logger.warn(`[Apify] Circuit breaker is OPEN, skipping Apify for group ${groupId}`);
    throw new Error('Apify circuit breaker is open - service temporarily disabled');
  }

  const client = getApifyClient();
  const groupUrl = `https://www.facebook.com/groups/${groupId}`;

  logger.info(`Starting Apify scrape for group ${groupId} (limit: ${resultsLimit})`);

  // Execute with circuit breaker protection
  return apifyCircuitBreaker.execute(async () => {
    // Run the Apify actor
    const run = await client.actor(FACEBOOK_SCRAPER_ACTOR).call({
      startUrls: [{ url: groupUrl }],
      resultsLimit,
      // Additional options for better results
      maxRequestRetries: 3,
      // Proxy configuration is handled by Apify
    });

    logger.info(`Apify run started: ${run.id}, status: ${run.status}`);

    // Wait for the run to finish and get results
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    logger.info(`Apify returned ${items.length} raw items for group ${groupId}`);

    // Check if Apify returned an error response
    // Apify returns { error: "no_items", errorDescription: "Empty or private data..." } when it can't access the group
    if (items.length === 1) {
      const firstItem = items[0] as Record<string, unknown>;
      if (firstItem.error) {
        const errorMsg = `Apify error: ${firstItem.error} - ${firstItem.errorDescription || 'Unknown error'}`;
        logger.warn(`[Apify] ${errorMsg} for group ${groupId}`);
        // Throw an error so this counts as a failure, not "0 posts returned"
        // This is important because Apify being blocked by Facebook doesn't mean the group is private
        throw new Error(errorMsg);
      }
    }

    // Check if all items are error responses (shouldn't happen but be safe)
    const errorItems = items.filter((item) => (item as Record<string, unknown>).error);
    if (errorItems.length > 0 && errorItems.length === items.length) {
      const firstError = errorItems[0] as Record<string, unknown>;
      throw new Error(`Apify returned only errors: ${firstError.error}`);
    }

    // Filter out any error items from the results
    const validItems = items.filter((item) => !(item as Record<string, unknown>).error);

    logger.info(`Apify returned ${validItems.length} valid posts for group ${groupId}`);

    // Normalize posts to our format
    const normalizedPosts: NormalizedPost[] = [];

    for (const item of validItems) {
      const post = item as ApifyFacebookPost;
      const normalized = normalizePost(post, groupId);

      if (normalized) {
        normalizedPosts.push(normalized);
      }
    }

    logger.info(`Normalized ${normalizedPosts.length} posts from group ${groupId}`);

    return normalizedPosts;
  });
};

/**
 * Check if Apify is properly configured
 */
export const isApifyConfigured = (): boolean => {
  return Boolean(process.env.APIFY_TOKEN);
};
