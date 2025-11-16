import { Page } from 'playwright';
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

export const extractPosts = async (page: Page): Promise<ScrapedPost[]> => {
  const posts: ScrapedPost[] = [];
  const containers = await page.$$(selectors.postContainer);
  const limit = Math.floor(Math.random() * 21) + 20; // 20-40 posts

  for (const container of containers) {
    const postId = normalizePostId(await container.getAttribute('data-ft'), await container.getAttribute('id'));
    if (!postId) continue;

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
      continue;
    }

    const authorHandle = await container.$(selectors.authorName);
    const authorName = authorHandle ? (await authorHandle.innerText()).trim() : undefined;
    const authorLinkHandle = await container.$(selectors.authorLink);
    const authorLink = authorLinkHandle ? await authorLinkHandle.getAttribute('href') : undefined;

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
