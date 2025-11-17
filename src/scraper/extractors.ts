import { Page } from 'playwright';
import { selectors, queryAllOnPage, findFirstHandle } from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import logger from '../utils/logger';

export interface ScrapedPost {
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  text: string;
}

const normalizePostId = (rawId: string | null, fallback: string | null, text: string): string => {
  if (rawId) {
    try {
      const parsed = JSON.parse(rawId);
      return parsed?.top_level_post_id || parsed?.mf_story_key || rawId;
    } catch {
      return rawId;
    }
  }

  if (fallback) {
    return fallback;
  }

  // Generate a unique ID from text hash if no ID found
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `generated_${Math.abs(hash)}_${text.length}`;
};

export const extractPosts = async (page: Page): Promise<ScrapedPost[]> => {
  const posts: ScrapedPost[] = [];
  
  logger.info('Starting post extraction...');
  
  // Try to find containers
  const { handles: containers, selector: usedSelector } = await queryAllOnPage(page, selectors.postContainer);
  
  logger.info(`Found ${containers.length} post containers using selector: ${usedSelector}`);
  
  if (containers.length === 0) {
    logger.warn('No post containers found! Trying alternative selectors...');
    
    // Debug: Log page content structure
    const pageContent = await page.content();
    logger.info(`Page has ${pageContent.length} characters of HTML`);
    
    // Try to find any divs with role="article"
    const articleDivs = await page.$$('div[role="article"]');
    logger.info(`Found ${articleDivs.length} divs with role="article"`);
    
    // Try to find feed units
    const feedUnits = await page.$$('div[data-pagelet^="FeedUnit"]');
    logger.info(`Found ${feedUnits.length} feed unit divs`);
    
    return posts;
  }
  
  const limit = Math.floor(Math.random() * 21) + 20; // 20-40 posts

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];
    
    logger.info(`Processing container ${i + 1}/${containers.length}`);
    
    // Extract text first (we need it for ID generation)
    let text = '';
    for (const textSelector of selectors.postTextCandidates) {
      const textHandle = await container.$(textSelector);
      if (textHandle) {
        const candidate = (await textHandle.innerText())?.trim();
        if (candidate && candidate.length > text.length) {
          text = candidate;
        }
      }
    }

    if (!text || text.length < 30) {
      logger.warn(`Container ${i + 1}: Text too short or missing (${text.length} chars)`);
      continue;
    }
    
    logger.info(`Container ${i + 1}: Found text with ${text.length} characters`);
    
    // Now get post ID (using text as fallback)
    const postId = normalizePostId(
      await container.getAttribute('data-ft'), 
      await container.getAttribute('id'),
      text
    );
    
    logger.info(`Container ${i + 1}: Generated post ID: ${postId}`);

    const authorHandle = await findFirstHandle(container, selectors.authorName);
    const authorName = authorHandle.handle ? (await authorHandle.handle.innerText()).trim() : undefined;
    
    const authorLinkHandle = await findFirstHandle(container, selectors.authorLink);
    const authorLinkRaw = authorLinkHandle.handle
      ? await authorLinkHandle.handle.getAttribute('href')
      : null;
    const authorLink = authorLinkRaw ?? undefined;

    logger.info(`Container ${i + 1}: Author: ${authorName || 'Unknown'}`);

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