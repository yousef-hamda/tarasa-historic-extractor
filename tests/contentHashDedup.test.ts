/**
 * Regression tests for the duplicate-posts root cause.
 *
 * The same Facebook post was being re-inserted every scrape cycle because the
 * content hash (used as the fallback fbPostId) was computed from:
 *   1. the RAW author link, which carries volatile FB tracking params
 *      (__cft__, __tn__, eav…) that rotate on every render, and
 *   2. un-normalized text, so a single "\n" vs "\n\n" rendering difference
 *      forked the hash.
 *
 * These tests import the REAL generateContentHash (not a re-implementation) so
 * the production behavior is pinned.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { generateContentHash } from '../src/scraper/extractors';

const BODY = 'זהו סיפורו של אחד הבתים המסתוריים ברחביה, ירושלים.';

describe('generateContentHash — stable across scrape-to-scrape drift', () => {
  it('is invariant to volatile author-link tracking params', () => {
    const clean = 'https://www.facebook.com/profile.php?id=1025935738';
    const withTracking =
      'https://www.facebook.com/profile.php?id=1025935738&__cft__[0]=AbcXYZ&__tn__=R]-R';
    const withTracking2 =
      'https://www.facebook.com/profile.php?id=1025935738&__cft__[0]=DIFFERENT&__tn__=%2CO';
    expect(generateContentHash(BODY, withTracking)).toBe(generateContentHash(BODY, clean));
    expect(generateContentHash(BODY, withTracking)).toBe(generateContentHash(BODY, withTracking2));
  });

  it('is invariant to /user/ vs profile.php link shape for the same author', () => {
    const a = 'https://www.facebook.com/user/1025935738/';
    const b = 'https://www.facebook.com/profile.php?id=1025935738';
    expect(generateContentHash(BODY, a)).toBe(generateContentHash(BODY, b));
  });

  it('is invariant to trivial whitespace differences (\\n vs \\n\\n)', () => {
    const single = 'רחוב עזה 6\n#רחביה\nזהו סיפורו של אחד הבתים';
    const doubled = 'רחוב עזה 6\n#רחביה\n\nזהו סיפורו של אחד הבתים';
    expect(generateContentHash(single)).toBe(generateContentHash(doubled));
  });

  it('is invariant to a trailing time-ago suffix', () => {
    const withTime = `${BODY}\n5h`;
    const withTimeHe = `${BODY}\nלפני 5 שעות`;
    expect(generateContentHash(withTime)).toBe(generateContentHash(BODY));
    expect(generateContentHash(withTimeHe)).toBe(generateContentHash(BODY));
  });

  it('still distinguishes genuinely different posts by the same author', () => {
    const link = 'https://www.facebook.com/profile.php?id=1025935738';
    expect(generateContentHash('post one', link)).not.toBe(
      generateContentHash('post two', link)
    );
  });

  it('still distinguishes the same text by different authors', () => {
    const a = 'https://www.facebook.com/profile.php?id=111111111';
    const b = 'https://www.facebook.com/profile.php?id=222222222';
    expect(generateContentHash(BODY, a)).not.toBe(generateContentHash(BODY, b));
  });

  it('produces a deterministic 32-char hex digest', () => {
    const h = generateContentHash(BODY, 'https://www.facebook.com/profile.php?id=1');
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});
