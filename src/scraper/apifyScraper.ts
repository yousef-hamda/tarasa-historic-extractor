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

// Apify Actor for Facebook scraping
const FACEBOOK_SCRAPER_ACTOR = 'apify/facebook-posts-scraper';

// Default results limit (configurable via env)
const DEFAULT_RESULTS_LIMIT = Number(process.env.APIFY_RESULTS_LIMIT) || 20;

/**
 * Raw post data returned by Apify's Facebook scraper
 */
export interface ApifyFacebookPost {
  postId: string;
  postUrl: string;
  pageName?: string;
  pageUrl?: string;
  userName?: string;
  userUrl?: string;
  text?: string;
  timestamp?: string;
  time?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  media?: Array<{
    type: string;
    url: string;
  }>;
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
 * Normalize a single Apify post to our database format
 */
const normalizePost = (post: ApifyFacebookPost, groupId: string): NormalizedPost | null => {
  // Log raw post data for debugging (debug level to avoid verbose production logs)
  logger.debug(`Raw Apify post keys: ${Object.keys(post).join(', ')}`);
  logger.debug(`Raw Apify post sample: ${JSON.stringify(post).substring(0, 300)}`);

  // Skip posts without ID or text
  if (!post.postId || !post.text?.trim()) {
    logger.info(`Skipping post - postId: ${post.postId}, hasText: ${Boolean(post.text?.trim())}`);
    return null;
  }

  // Extract author info - try multiple fields
  const authorName = post.userName || post.pageName || null;
  const authorLink = normalizeAuthorLink(post.userUrl || post.pageUrl);

  return {
    fbPostId: post.postId,
    groupId,
    authorName,
    authorLink,
    text: post.text.trim(),
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
  const client = getApifyClient();
  const groupUrl = `https://www.facebook.com/groups/${groupId}`;

  logger.info(`Starting Apify scrape for group ${groupId} (limit: ${resultsLimit})`);

  try {
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

    logger.info(`Apify returned ${items.length} raw posts for group ${groupId}`);

    // Normalize posts to our format
    const normalizedPosts: NormalizedPost[] = [];

    for (const item of items) {
      const post = item as ApifyFacebookPost;
      const normalized = normalizePost(post, groupId);

      if (normalized) {
        normalizedPosts.push(normalized);
      }
    }

    logger.info(`Normalized ${normalizedPosts.length} valid posts from group ${groupId}`);

    return normalizedPosts;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Apify scrape failed for group ${groupId}: ${errorMessage}`);
    throw error;
  }
};

/**
 * Check if Apify is properly configured
 */
export const isApifyConfigured = (): boolean => {
  return Boolean(process.env.APIFY_TOKEN);
};
