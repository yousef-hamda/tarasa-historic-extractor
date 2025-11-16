import { Page, ElementHandle } from 'playwright';
import { selectors } from '../utils/selectors';
import { humanDelay } from '../utils/delays';

export interface ScrapedPost {
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  text: string;
}

const normalizePostId = (rawId: string | null, fallback: string | null): string | null => {
  if (!rawId && !fallback) {
    return null;
  }

  if (rawId) {
    try {
      const parsed = JSON.parse(rawId);
      return parsed?.top_level_post_id || parsed?.mf_story_key || rawId;
    } catch {
      return rawId;
    }
  }

  return fallback;
};

const collectContainers = async (page: Page) => {
  for (const selector of selectors.postContainers) {
    const handles = await page.$$(selector);
    if (handles.length) {
      return handles;
    }
  }
  return [] as ElementHandle<Element>[];
};

const extractText = async (container: ElementHandle<Element>) => {
  for (const textSelector of selectors.postTextCandidates) {
    const matches = await container.$$(textSelector);
    for (const match of matches) {
      const candidate = (await match.innerText())?.trim();
      if (candidate && candidate.length >= 30) {
        return candidate;
      }
    }
  }
  return '';
};

const extractFirstMatch = async (
  container: ElementHandle<Element>,
  selectorList: string[],
  getter: (handle: ElementHandle<Element>) => Promise<string | null>,
) => {
  for (const selector of selectorList) {
    const handle = await container.$(selector);
    if (handle) {
      const value = await getter(handle);
      if (value) {
        return value.trim();
      }
    }
  }
  return undefined;
};

export const extractPosts = async (page: Page): Promise<ScrapedPost[]> => {
  const posts: ScrapedPost[] = [];
  const containers = await collectContainers(page);
  const limit = Math.floor(Math.random() * 21) + 20; // 20-40 posts

  for (const container of containers) {
    const postId = normalizePostId(await container.getAttribute('data-ft'), await container.getAttribute('id'));
    if (!postId) continue;

    const text = await extractText(container);
    if (!text) {
      continue;
    }

    const authorName = await extractFirstMatch(container, selectors.authorNameCandidates, (handle) => handle.innerText());
    const authorLink = await extractFirstMatch(container, selectors.authorLinkCandidates, (handle) => handle.getAttribute('href'));

    posts.push({
      fbPostId: postId,
      authorName,
      authorLink,
      text,
    });

    if (posts.length >= limit) break;
  }

  await humanDelay();

  return posts;
};
