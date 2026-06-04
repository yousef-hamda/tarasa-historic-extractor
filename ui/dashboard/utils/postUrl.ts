/**
 * Compute the best available Facebook URL for a post.
 *
 *   1. If the extractor captured a `postUrl`, use it as-is.
 *   2. Otherwise, when the post's `fbPostId` looks like a numeric FB id (not
 *      our `hash_<sha>` content-hash fallback), construct the canonical
 *      `/groups/{groupId}/posts/{fbPostId}` URL.
 *   3. Otherwise return null — the row will simply not render the link.
 *
 * Centralized so the Posts table row and the PostDetailModal can't drift in
 * how they decide whether to show "Open on Facebook".
 */
export const effectivePostUrl = (post: {
  postUrl?: string | null;
  fbPostId?: string | null;
  groupId?: string | null;
}): string | null => {
  if (post.postUrl) return post.postUrl;
  if (!post.fbPostId || !post.groupId) return null;
  if (post.fbPostId.startsWith('hash_')) return null;
  if (!/^\d+$/.test(post.fbPostId)) return null;
  return `https://www.facebook.com/groups/${post.groupId}/posts/${post.fbPostId}`;
};
