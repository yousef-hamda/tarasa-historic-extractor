/**
 * Group-avatar selection.
 *
 * On a logged-in Facebook group feed page MANY anchors link back to the group,
 * e.g.:
 *   /groups/<gid>                     ← the group itself (header title + avatar)
 *   /groups/<gid>/user/<uid>/         ← a member / post author
 *   /groups/<gid>/posts/<pid>/        ← a post permalink
 *   /groups/<gid>/media/...           ← a photo
 *
 * A naive `a[href*="/groups/<gid>"] img` therefore frequently grabs the FIRST
 * post author's avatar (a member's profile picture) instead of the group's own
 * avatar — which is exactly the bug this module fixes.
 *
 * The picking logic is kept here as a pure function so it can be unit-tested:
 * `page.evaluate` (which runs in the browser and can't reference Node helpers)
 * only collects serializable candidate descriptors; the choice is made here.
 */

/** A serializable description of one `<a>`-wrapped image found on the page. */
export interface AvatarCandidate {
  /** The anchor's raw href. */
  href: string;
  /** The image src (already filtered to scontent/fbcdn URLs by the collector). */
  src: string;
  /** The image's alt text, if any. */
  alt?: string | null;
  /** The anchor's aria-label, if any. */
  ariaLabel?: string | null;
  /** getBoundingClientRect().top of the image, if measurable. */
  top?: number | null;
  /** getBoundingClientRect().width of the image, if measurable. */
  width?: number | null;
}

/** Pull the `/groups/<segment>` path out of an href, ignoring host/query/hash. */
const groupPath = (href: string): string | null => {
  if (!href) return null;
  // Strip protocol+host and any query/hash so we look only at the path.
  let path = href;
  const schemeMatch = path.match(/^https?:\/\/[^/]+(\/.*)$/i);
  if (schemeMatch) path = schemeMatch[1];
  path = path.split('?')[0].split('#')[0];
  if (!path.startsWith('/')) path = '/' + path;
  return path;
};

/** The group id/vanity segment of a /groups/<seg>... path, or null. */
const groupSegment = (path: string | null): string | null => {
  if (!path) return null;
  const m = path.match(/^\/groups\/([^/]+)/);
  return m ? m[1] : null;
};

/** True when the path is the group root (`/groups/<seg>` or `/groups/<seg>/`). */
const isGroupRoot = (path: string | null): boolean =>
  !!path && /^\/groups\/[^/]+\/?$/.test(path);

/**
 * True when the path is a sub-resource of a group — a member, post, media,
 * etc. These wrap member/content thumbnails, never the group's own avatar.
 */
const isGroupSubResource = (path: string | null): boolean =>
  !!path && /^\/groups\/[^/]+\/.+/.test(path);

/**
 * Choose the group's own avatar from the collected candidates.
 *
 * Scoring (higher wins):
 *  - group-root link whose segment matches the scraped id   → strongest
 *  - group-root link to some other segment (numeric↔vanity) → moderate
 *  - aria-label / alt text contains the group name          → strong signal
 *  - image sits in the top header band                      → bonus
 *  - image is avatar-sized                                  → bonus
 *
 * Member/post/media sub-resource links are rejected outright, so a post
 * author's picture can never be chosen.
 *
 * @returns the chosen image src, or null when nothing qualifies.
 */
export const pickGroupAvatar = (
  candidates: AvatarCandidate[],
  opts: { groupId?: string | null; groupName?: string | null } = {}
): string | null => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  const gid = (opts.groupId || '').toString();
  const name = (opts.groupName || '').trim().toLowerCase();

  let best: { src: string; score: number } | null = null;

  for (const c of candidates) {
    if (!c || !c.src) continue;
    // Only accept real Facebook CDN image URLs.
    if (!/^https?:\/\//i.test(c.src)) continue;
    if (!/scontent|fbcdn/i.test(c.src)) continue;

    const path = groupPath(c.href);

    // Reject member / post / media / event sub-resource links entirely — these
    // wrap a person's or a post's thumbnail, never the group avatar.
    if (isGroupSubResource(path)) continue;

    const root = isGroupRoot(path);
    const seg = groupSegment(path);

    // A candidate must either point at a group root or carry a name match;
    // anything else (random scontent image with an unrelated link) is ignored.
    const label = `${c.ariaLabel || ''} ${c.alt || ''}`.trim().toLowerCase();
    const nameMatch = !!name && name.length > 2 && label.includes(name);

    if (!root && !nameMatch) continue;

    let score = 0;
    if (root && gid && seg === gid) score += 100;
    else if (root) score += 40;
    if (nameMatch) score += 50;

    const top = c.top;
    if (typeof top === 'number' && top >= 0 && top < 320) score += 30;

    const width = c.width;
    if (typeof width === 'number' && width >= 36 && width <= 220) score += 10;

    if (!best || score > best.score) best = { src: c.src, score };
  }

  return best ? best.src : null;
};
