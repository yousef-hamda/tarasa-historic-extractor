import { ElementHandle, Page } from 'playwright';
import { selectors, queryAllOnPage, findFirstHandle } from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import logger from '../utils/logger';

export interface ScrapedPost {
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  text: string;
}

const normalizeFacebookUrl = (href: string | null | undefined): string | undefined => {
  if (!href) return undefined;

  const trimmed = href.trim();
  if (!trimmed) return undefined;

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return `https://www.facebook.com${trimmed}`;
  }

  return `https://www.facebook.com/${trimmed}`;
};

const extractPostIdFromAnchors = async (
  container: ElementHandle<HTMLElement | SVGElement | Element>,
): Promise<string | null> => {
  try {
    const hrefs = await container.$$eval('a[href]', (links) =>
      links
        .map((link) => (link as HTMLAnchorElement).getAttribute('href') || '')
        .filter(Boolean),
    );

    const absoluteHrefs = hrefs.map((href) => normalizeFacebookUrl(href) || href);

    const patterns = [
      /\/posts\/(\d+)/i,
      /\/permalink\/(\d+)/i,
      /story_fbid=(\d+)/i,
      /fbid=(\d+)/i,
    ];

    for (const href of absoluteHrefs) {
      for (const pattern of patterns) {
        const match = href.match(pattern);
        if (match?.[1]) {
          return match[1];
        }
      }
    }
  } catch (error) {
    logger.warn(`Failed to extract post ID from anchors: ${(error as Error).message}`);
  }

  return null;
};

const normalizePostId = (
  rawId: string | null,
  fallback: string | null,
  linkDerivedId: string | null,
  text: string,
): string => {
  if (rawId) {
    try {
      const parsed = JSON.parse(rawId);
      return parsed?.top_level_post_id || parsed?.mf_story_key || rawId;
    } catch {
      return rawId;
    }
  }

  if (linkDerivedId) {
    return linkDerivedId;
  }

  if (fallback) {
    return fallback;
  }

  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `generated_${Math.abs(hash)}_${text.length}`;
};

export const extractPosts = async (page: Page): Promise<ScrapedPost[]> => {
  const posts: ScrapedPost[] = [];
  
  logger.info('Starting post extraction...');
  
  const { handles: containers, selector: usedSelector } = await queryAllOnPage(page, selectors.postContainer);
  
  logger.info(`Found ${containers.length} post containers using selector: ${usedSelector}`);
  
  if (containers.length === 0) {
    logger.warn('No post containers found!');
    return posts;
  }
  
  const limit = Math.floor(Math.random() * 21) + 20;

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];

    logger.info(`Processing container ${i + 1}/${containers.length}`);

    for (const seeMoreSelector of selectors.seeMoreButtons) {
      const seeMoreHandle = await container.$(seeMoreSelector);
      if (seeMoreHandle) {
        try {
          await seeMoreHandle.click({ force: true });
          await humanDelay(200, 400);
          logger.info(`Container ${i + 1}: Expanded post text`);
          break;
        } catch (error) {
          logger.warn(`Container ${i + 1}: Failed to click see more: ${(error as Error).message}`);
        }
      }
    }

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
    
    const postId = normalizePostId(
      await container.getAttribute('data-ft'),
      await container.getAttribute('id'),
      await extractPostIdFromAnchors(container),
      text,
    );
    
    logger.info(`Container ${i + 1}: Generated post ID: ${postId}`);

    const authorHandle = await findFirstHandle(container, selectors.authorName);
    let authorName: string | undefined = undefined;
    
    if (authorHandle.handle) {
      const ariaLabel = await authorHandle.handle.getAttribute('aria-label');
      if (ariaLabel && ariaLabel.trim()) {
        authorName = ariaLabel.trim();
      } else {
        const innerText = await authorHandle.handle.innerText();
        if (innerText && innerText.trim()) {
          authorName = innerText.trim();
        }
      }
    }

    const authorLinkHandle = await findFirstHandle(container, selectors.authorLink);
    let authorLink: string | undefined = undefined;
    
    if (authorLinkHandle.handle) {
      const ariaLabel = await authorLinkHandle.handle.getAttribute('aria-label');
      const href = await authorLinkHandle.handle.getAttribute('href');
      const dataLynx = await authorLinkHandle.handle.getAttribute('data-lynx-uri');
      
      const rawLink = href || dataLynx;
      authorLink = normalizeFacebookUrl(rawLink);
      
      if (!authorName && ariaLabel && ariaLabel.trim()) {
        authorName = ariaLabel.trim();
      }
    }

    logger.info(`Container ${i + 1}: Author: ${authorName || 'Unknown'}, Link: ${authorLink ? 'Found' : 'Missing'}`);

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
