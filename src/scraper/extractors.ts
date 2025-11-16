import { Page } from 'playwright';
import { selectors } from '../utils/selectors';
import { humanDelay } from '../utils/delays';

export interface ScrapedPost {
  fbPostId: string;
  authorName?: string;
  authorLink?: string;
  text: string;
}

export const extractPosts = async (page: Page): Promise<ScrapedPost[]> => {
  const posts: ScrapedPost[] = [];
  const containers = await page.$$(selectors.postContainer);

  for (const container of containers) {
    const postId = (await container.getAttribute('data-ft')) || (await container.getAttribute('id'));
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

    if (posts.length >= 40) break;
  }

  await humanDelay();

  return posts;
};
