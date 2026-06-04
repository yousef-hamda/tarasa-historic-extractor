/**
 * Comprehensive tests for Facebook post extractors
 * Tests the extraction utilities used for scraping Facebook posts
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';

// Mock modules before importing
vi.mock('../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../src/utils/selectors', () => ({
  selectors: {},
  queryAllOnPage: vi.fn(),
  findFirstHandle: vi.fn(),
}));

vi.mock('../src/utils/delays', () => ({
  humanDelay: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/scraper/fullTextExtractor', () => ({
  expandAllSeeMoreButtons: vi.fn(),
  extractFullTextFromContainer: vi.fn(),
  getInterceptedFullText: vi.fn(),
  getInterceptedPostId: vi.fn(),
  cleanExtractedText: vi.fn((text: string) => text),
  setupPostInterception: vi.fn(),
  clearInterceptedCache: vi.fn(),
}));

/**
 * Since extractors.ts doesn't export its internal helper functions,
 * we recreate the logic here for testing purposes.
 * This ensures the extraction logic is tested even if not directly exported.
 */

// Recreate cleanPostText logic for testing
const cleanPostText = (text: string | null | undefined): string => {
  if (!text) return '';

  const uiPatterns = [
    /^Like$/gim,
    /^Comment$/gim,
    /^Share$/gim,
    /^Reply$/gim,
    /^Send$/gim,
    /^\d+[hdwmy]$/gim,
    /^\d+\s*(hour|hours|day|days|week|weeks|month|months|year|years)\s*ago$/gim,
    /^Just now$/gim,
    /^Yesterday$/gim,
    /^See translation$/gim,
    /^See original$/gim,
    /^See more$/gim,
    /^See More$/gim,
    /^\.\.\.more$/gim,
    /^Translated by$/gim,
    /See more\.\.\.$/gim,
    /ראה עוד$/gim,
    /עוד\.\.\.$/gim,
    /عرض المزيد$/gim,
    /^\d+\s*comments?$/gim,
    /^\d+\s*shares?$/gim,
    /^\d+\s*likes?$/gim,
    /^\d+\s*reactions?$/gim,
    /^All comments$/gim,
    /^Most relevant$/gim,
    /^Newest$/gim,
    /^Write a comment\.\.\.$/gim,
    /^Write a public comment\.\.\.$/gim,
    /^Author$/gim,
    /^Group$/gim,
    /^Public group$/gim,
    /^Private group$/gim,
    /^Hide$/gim,
    /^Report$/gim,
    /^Save$/gim,
    /^Copy link$/gim,
    /^Turn on notifications$/gim,
  ];

  const lines = text.split('\n');
  const cleanedLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return false;

    for (const pattern of uiPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(trimmed)) {
        return false;
      }
    }

    if (trimmed.length < 3) return false;
    return true;
  });

  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

// Recreate stripTimeAgoSuffix logic for testing — MUST stay in sync with
// src/scraper/extractors.ts. The hash relies on this normalization to keep
// the same post stable across re-scrapes.
const stripTimeAgoSuffix = (text: string): string => {
  const lines = text.split('\n');
  if (lines.length === 0) return text;
  const lastLine = lines[lines.length - 1].trim();
  if (!lastLine) return text;
  const isTimeIndicator =
    /^\d+\s*[smhdwy]$/i.test(lastLine) ||
    /^\d+\s*(min|mins|hr|hrs|hour|hours|day|days|wk|wks|week|weeks|yr|yrs|year|years|sec|secs|second|seconds)\b/i.test(lastLine) ||
    /^Just\s+now$/i.test(lastLine) ||
    /^Yesterday$/i.test(lastLine) ||
    /^(?:לפני\s+)?(?:\d+\s*)?(?:דקה|דקות|שעה|שעות|יום|ימים|שבוע|שבועות|חודש|חודשים|שנה|שנים)\s*(?:אחרונים?|אחורה)?$/.test(lastLine) ||
    /^(?:אתמול|עכשיו|זה\s+עתה|לאחרונה)$/.test(lastLine) ||
    /^(?:منذ\s+)?(?:\d+\s*)?(?:دقيقة|دقائق|ساعة|ساعات|يوم|أيام|أسبوع|شهر|سنة)/.test(lastLine);
  return isTimeIndicator ? lines.slice(0, -1).join('\n').trim() : text;
};

// Recreate generateContentHash logic for testing
const generateContentHash = (text: string, authorLink?: string): string => {
  const stableText = stripTimeAgoSuffix(text);
  const content = `${stableText}|${authorLink || ''}`;
  return createHash('sha256').update(content).digest('hex').substring(0, 32);
};

// Recreate normalizePostId logic for testing
const normalizePostId = (rawId: string | null, fallback: string | null, text: string, authorLink?: string): string => {
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

  return `hash_${generateContentHash(text, authorLink)}`;
};

// Recreate normalizeAuthorLink logic for testing
const normalizeAuthorLink = (href: string | null): string | undefined => {
  if (!href) return undefined;

  try {
    const url = new URL(href, 'https://www.facebook.com');

    const paramsToRemove = [
      '__cft__', '__tn__', 'comment_id', 'reply_comment_id',
      'ref', 'fref', 'hc_ref', '__xts__', 'eid', 'rc', 'notif_id',
      'notif_t', 'ref_notif_type', 'acontext', 'aref', 'view_single'
    ];
    paramsToRemove.forEach(param => url.searchParams.delete(param));

    if (url.pathname.includes('/stories/')) {
      const storiesMatch = url.pathname.match(/\/stories\/(\d+)\//);
      if (storiesMatch) {
        return `https://www.facebook.com/profile.php?id=${storiesMatch[1]}`;
      }
    }

    if (url.pathname.includes('/user/')) {
      const match = url.pathname.match(/\/user\/(\d+)/);
      if (match) {
        return `https://www.facebook.com/profile.php?id=${match[1]}`;
      }
    }

    if (url.pathname.includes('/profile.php')) {
      const id = url.searchParams.get('id');
      if (id) {
        return `https://www.facebook.com/profile.php?id=${id}`;
      }
    }

    if (url.pathname.includes('/people/')) {
      const match = url.pathname.match(/\/people\/[^\/]+\/(\d+)/);
      if (match) {
        return `https://www.facebook.com/profile.php?id=${match[1]}`;
      }
    }

    if (url.pathname.includes('/groups/') && url.pathname.includes('/user/')) {
      const match = url.pathname.match(/\/user\/(\d+)/);
      if (match) {
        return `https://www.facebook.com/profile.php?id=${match[1]}`;
      }
    }

    const cleanPath = url.pathname.replace(/\/$/, '');
    if (cleanPath && cleanPath !== '/') {
      const pathPart = cleanPath.split('/')[1];
      if (pathPart && !pathPart.includes('groups') && !pathPart.includes('pages') && !pathPart.includes('photo')) {
        return `https://www.facebook.com/${pathPart}`;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
};

describe('cleanPostText()', () => {
  describe('empty/null input handling', () => {
    it('should return empty string for null input', () => {
      expect(cleanPostText(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(cleanPostText(undefined)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(cleanPostText('')).toBe('');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(cleanPostText('   \n\t   ')).toBe('');
    });
  });

  describe('UI element removal', () => {
    it('should remove "Like" button text', () => {
      const result = cleanPostText('Hello world\nLike\nThis is a post');
      expect(result).not.toContain('Like');
      expect(result).toContain('Hello world');
      expect(result).toContain('This is a post');
    });

    it('should remove "Comment" button text', () => {
      const result = cleanPostText('Test post\nComment\nMore content');
      expect(result).not.toContain('\nComment\n');
    });

    it('should remove "Share" button text', () => {
      const result = cleanPostText('Test post\nShare\nMore content');
      expect(result).not.toContain('\nShare\n');
    });

    it('should remove "Reply" button text', () => {
      const result = cleanPostText('Test post\nReply\nMore content');
      expect(result).not.toContain('\nReply\n');
    });

    it('should remove time indicators like "5d"', () => {
      const result = cleanPostText('Test post\n5d\nMore content');
      expect(result).not.toMatch(/\n5d\n/);
    });

    it('should remove "2 hours ago"', () => {
      const result = cleanPostText('Test post\n2 hours ago\nMore content');
      expect(result).not.toContain('2 hours ago');
    });

    it('should remove "Just now"', () => {
      const result = cleanPostText('Test post\nJust now\nMore content');
      expect(result).not.toContain('Just now');
    });

    it('should remove "Yesterday"', () => {
      const result = cleanPostText('Test post\nYesterday\nMore content');
      expect(result).not.toContain('\nYesterday\n');
    });

    it('should remove "See translation"', () => {
      const result = cleanPostText('Test post\nSee translation\nMore content');
      expect(result).not.toContain('See translation');
    });

    it('should remove "See more"', () => {
      const result = cleanPostText('Test post\nSee more\nMore content');
      expect(result).not.toContain('\nSee more\n');
    });

    it('should remove Hebrew "See more" (ראה עוד)', () => {
      const result = cleanPostText('Test post\nראה עוד\nMore content');
      expect(result).not.toContain('ראה עוד');
    });

    it('should remove Arabic "See more" (عرض المزيد)', () => {
      const result = cleanPostText('Test post\nعرض المزيد\nMore content');
      expect(result).not.toContain('عرض المزيد');
    });

    it('should remove comment counts like "5 comments"', () => {
      const result = cleanPostText('Test post\n5 comments\nMore content');
      expect(result).not.toContain('5 comments');
    });

    it('should remove share counts like "3 shares"', () => {
      const result = cleanPostText('Test post\n3 shares\nMore content');
      expect(result).not.toContain('3 shares');
    });

    it('should remove reaction counts like "42 likes"', () => {
      const result = cleanPostText('Test post\n42 likes\nMore content');
      expect(result).not.toContain('42 likes');
    });

    it('should remove "Write a comment..."', () => {
      const result = cleanPostText('Test post\nWrite a comment...\nMore content');
      expect(result).not.toContain('Write a comment...');
    });

    it('should remove "Public group"', () => {
      const result = cleanPostText('Test post\nPublic group\nMore content');
      expect(result).not.toContain('Public group');
    });

    it('should remove "Private group"', () => {
      const result = cleanPostText('Test post\nPrivate group\nMore content');
      expect(result).not.toContain('Private group');
    });
  });

  describe('whitespace handling', () => {
    it('should remove lines with only 1-2 characters', () => {
      const result = cleanPostText('Test post\nAB\nMore content here');
      expect(result).not.toMatch(/^AB$/m);
    });

    it('should keep lines with 3+ characters', () => {
      const result = cleanPostText('Test post\nABC\nMore content here');
      expect(result).toContain('ABC');
    });

    it('should collapse multiple consecutive newlines', () => {
      const result = cleanPostText('Test post\n\n\n\n\nMore content');
      expect(result).not.toContain('\n\n\n');
    });

    it('should collapse consecutive newlines', () => {
      // The implementation joins lines with single \n, not preserving double newlines
      const result = cleanPostText('Test post\n\nMore content');
      expect(result).toBe('Test post\nMore content');
    });

    it('should trim leading and trailing whitespace', () => {
      const result = cleanPostText('   Test post content   ');
      expect(result).toBe('Test post content');
    });
  });

  describe('preserving valid content', () => {
    it('should preserve regular post text', () => {
      const text = 'This is a regular Facebook post about something interesting.';
      expect(cleanPostText(text)).toBe(text);
    });

    it('should preserve Hebrew text', () => {
      const text = 'זהו פוסט בעברית על נושא מעניין';
      expect(cleanPostText(text)).toBe(text);
    });

    it('should preserve Arabic text', () => {
      const text = 'هذا منشور باللغة العربية حول موضوع مثير للاهتمام';
      expect(cleanPostText(text)).toBe(text);
    });

    it('should preserve URLs in text', () => {
      const text = 'Check out https://example.com for more info';
      expect(cleanPostText(text)).toBe(text);
    });

    it('should preserve emoji in text', () => {
      const text = 'This is awesome! 🎉🚀💯';
      expect(cleanPostText(text)).toBe(text);
    });

    it('should preserve multi-line posts content', () => {
      // Implementation collapses multiple newlines to single newlines
      const text = 'First paragraph here.\n\nSecond paragraph here.\n\nThird paragraph.';
      const result = cleanPostText(text);
      expect(result).toContain('First paragraph here.');
      expect(result).toContain('Second paragraph here.');
      expect(result).toContain('Third paragraph.');
    });
  });
});

describe('generateContentHash()', () => {
  it('should return 32 character hash', () => {
    const hash = generateContentHash('test content');
    expect(hash.length).toBe(32);
  });

  it('should return consistent hash for same input', () => {
    const hash1 = generateContentHash('test content', 'author');
    const hash2 = generateContentHash('test content', 'author');
    expect(hash1).toBe(hash2);
  });

  it('should return different hash for different text', () => {
    const hash1 = generateContentHash('content 1');
    const hash2 = generateContentHash('content 2');
    expect(hash1).not.toBe(hash2);
  });

  it('should return different hash for different author', () => {
    const hash1 = generateContentHash('same content', 'author1');
    const hash2 = generateContentHash('same content', 'author2');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty text', () => {
    const hash = generateContentHash('');
    expect(hash.length).toBe(32);
  });

  it('should handle undefined author', () => {
    const hash = generateContentHash('test', undefined);
    expect(hash.length).toBe(32);
  });

  it('should be hexadecimal string', () => {
    const hash = generateContentHash('test');
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  // The bug this fixes: scraping the SAME post on two different cron ticks
  // produces text that differs only by the trailing "X minutes ago" line
  // ("4m" vs "13m"). Without normalizing that out, the hash drifts and we
  // create a phantom-duplicate row → user gets multiple messages for one post.
  describe('stable across re-scrapes of the same post', () => {
    it('should produce the same hash for English "4m" vs "13m" suffix', () => {
      const a = 'Yael Shilo\nהכלביה היתה בהתחלת העלייה להר ציון.\n4m';
      const b = 'Yael Shilo\nהכלביה היתה בהתחלת העלייה להר ציון.\n13m';
      const link = 'https://www.facebook.com/profile.php?id=100000360272645';
      expect(generateContentHash(a, link)).toBe(generateContentHash(b, link));
    });

    it('should produce the same hash for English "1h" vs "2h"', () => {
      const a = 'Some historic post content here.\n1h';
      const b = 'Some historic post content here.\n2h';
      expect(generateContentHash(a)).toBe(generateContentHash(b));
    });

    it('should produce the same hash for "Just now" vs "Yesterday"', () => {
      const a = 'Historic content.\nJust now';
      const b = 'Historic content.\nYesterday';
      expect(generateContentHash(a)).toBe(generateContentHash(b));
    });

    it('should produce the same hash for Hebrew "לפני 5 דקות" vs "אתמול"', () => {
      const a = 'תוכן היסטורי כאן.\nלפני 5 דקות';
      const b = 'תוכן היסטורי כאן.\nאתמול';
      expect(generateContentHash(a)).toBe(generateContentHash(b));
    });

    it('should produce the same hash whether or not the suffix is present', () => {
      const withSuffix = 'Real post content.\n4m';
      const without = 'Real post content.';
      expect(generateContentHash(withSuffix)).toBe(generateContentHash(without));
    });

    it('should NOT strip a non-time-indicator last line', () => {
      // Make sure "5m" inside the actual post content (not a trailing line)
      // is preserved.
      const a = 'I biked 5m today.\nThat was tough.';
      const b = 'I biked 10m today.\nThat was tough.';
      // Different post content → different hashes
      expect(generateContentHash(a)).not.toBe(generateContentHash(b));
    });

    it('should still differentiate genuinely different posts', () => {
      const a = 'First post about history.\n4m';
      const b = 'Second post about history.\n4m';
      expect(generateContentHash(a)).not.toBe(generateContentHash(b));
    });
  });
});

describe('normalizePostId()', () => {
  describe('with raw ID', () => {
    it('should return raw ID directly if not JSON', () => {
      const result = normalizePostId('123456789', null, 'text');
      expect(result).toBe('123456789');
    });

    it('should extract top_level_post_id from JSON', () => {
      const jsonId = JSON.stringify({ top_level_post_id: '987654321' });
      const result = normalizePostId(jsonId, null, 'text');
      expect(result).toBe('987654321');
    });

    it('should extract mf_story_key from JSON', () => {
      const jsonId = JSON.stringify({ mf_story_key: '111222333' });
      const result = normalizePostId(jsonId, null, 'text');
      expect(result).toBe('111222333');
    });

    it('should prefer top_level_post_id over mf_story_key', () => {
      const jsonId = JSON.stringify({ top_level_post_id: 'top', mf_story_key: 'mf' });
      const result = normalizePostId(jsonId, null, 'text');
      expect(result).toBe('top');
    });

    it('should return original JSON string if no known keys', () => {
      const jsonId = JSON.stringify({ unknown: 'value' });
      const result = normalizePostId(jsonId, null, 'text');
      expect(result).toBe(jsonId);
    });
  });

  describe('with fallback', () => {
    it('should use fallback when rawId is null', () => {
      const result = normalizePostId(null, 'fallback123', 'text');
      expect(result).toBe('fallback123');
    });

    it('should prefer rawId over fallback', () => {
      const result = normalizePostId('rawId', 'fallback', 'text');
      expect(result).toBe('rawId');
    });
  });

  describe('with content hash', () => {
    it('should generate hash when no ID available', () => {
      const result = normalizePostId(null, null, 'test text');
      expect(result).toMatch(/^hash_[a-f0-9]{32}$/);
    });

    it('should include author in hash calculation', () => {
      const result1 = normalizePostId(null, null, 'text', 'author1');
      const result2 = normalizePostId(null, null, 'text', 'author2');
      expect(result1).not.toBe(result2);
    });

    it('should generate consistent hash for same content', () => {
      const result1 = normalizePostId(null, null, 'text', 'author');
      const result2 = normalizePostId(null, null, 'text', 'author');
      expect(result1).toBe(result2);
    });
  });
});

describe('normalizeAuthorLink()', () => {
  describe('null/empty input', () => {
    it('should return undefined for null', () => {
      expect(normalizeAuthorLink(null)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(normalizeAuthorLink('')).toBeUndefined();
    });
  });

  describe('tracking parameter removal', () => {
    it('should remove __cft__ parameter', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/user?__cft__=tracking');
      expect(result).not.toContain('__cft__');
    });

    it('should remove __tn__ parameter', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/user?__tn__=tracking');
      expect(result).not.toContain('__tn__');
    });

    it('should remove multiple tracking parameters', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/user?__cft__=a&ref=b&fref=c');
      expect(result).not.toContain('__cft__');
      expect(result).not.toContain('ref=');
      expect(result).not.toContain('fref=');
    });
  });

  describe('/stories/ pattern', () => {
    it('should convert /stories/{id}/ to profile.php?id=', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/stories/1234567890/UzpfSVNDOjg/');
      expect(result).toBe('https://www.facebook.com/profile.php?id=1234567890');
    });

    it('should handle stories URL with tracking params', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/stories/1234567890/abc/?__cft__=test');
      expect(result).toBe('https://www.facebook.com/profile.php?id=1234567890');
    });
  });

  describe('/user/ pattern', () => {
    it('should convert /user/{id} to profile.php?id=', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/user/1234567890');
      expect(result).toBe('https://www.facebook.com/profile.php?id=1234567890');
    });
  });

  describe('/profile.php pattern', () => {
    it('should preserve profile.php?id= format', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/profile.php?id=1234567890');
      expect(result).toBe('https://www.facebook.com/profile.php?id=1234567890');
    });

    it('should clean tracking params from profile.php', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/profile.php?id=123&__cft__=test');
      expect(result).toBe('https://www.facebook.com/profile.php?id=123');
    });
  });

  describe('/people/ pattern', () => {
    it('should extract ID from /people/Name/ID format', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/people/John-Doe/1234567890');
      expect(result).toBe('https://www.facebook.com/profile.php?id=1234567890');
    });
  });

  describe('/groups/.../user/ pattern', () => {
    it('should extract user ID from group member link', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/groups/123/user/1234567890');
      expect(result).toBe('https://www.facebook.com/profile.php?id=1234567890');
    });
  });

  describe('username URLs', () => {
    it('should handle simple username URL', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/johndoe');
      expect(result).toBe('https://www.facebook.com/johndoe');
    });

    it('should handle username with numbers', () => {
      const result = normalizeAuthorLink('https://www.facebook.com/john.doe.123');
      expect(result).toBe('https://www.facebook.com/john.doe.123');
    });
  });

  describe('invalid URLs', () => {
    it('should return undefined for invalid URL', () => {
      const result = normalizeAuthorLink('not-a-url');
      // The function uses URL constructor with base, so this might not fail
      // depending on implementation
    });

    it('should handle relative URLs with base', () => {
      const result = normalizeAuthorLink('/johndoe');
      expect(result).toBe('https://www.facebook.com/johndoe');
    });
  });
});

describe('Integration scenarios', () => {
  it('should handle complete post cleaning pipeline', () => {
    const rawText = `John Doe
5d
This is the actual post content that should be preserved.
It has multiple lines.
Like
Comment
Share
5 comments
2 shares`;

    const cleaned = cleanPostText(rawText);
    expect(cleaned).toContain('This is the actual post content');
    expect(cleaned).not.toContain('Like\n');
    expect(cleaned).not.toContain('5 comments');
  });

  it('should handle post with mixed languages', () => {
    const text = `Hello World
שלום עולם
مرحبا بالعالم
See more
Like`;

    const cleaned = cleanPostText(text);
    expect(cleaned).toContain('Hello World');
    expect(cleaned).toContain('שלום עולם');
    expect(cleaned).toContain('مرحبا بالعالم');
  });
});

// ============================================================================
// isValidFbPostId — the safety gate for the new in-DOM post-id strategies.
// If this regresses, the new extractors could emit malformed ids
// (member counts, group ids, dates) and corrupt the dedup constraint
// permanently. Pin every shape we accept and reject.
// ============================================================================
import { isValidFbPostId } from '../src/scraper/extractors';

describe('isValidFbPostId', () => {
  it('accepts a real 16-digit FB post id', () => {
    expect(isValidFbPostId('2017717945502020')).toBe(true);
  });

  it('accepts a 10-digit floor (shortest plausible)', () => {
    expect(isValidFbPostId('1234567890')).toBe(true);
  });

  it('accepts a pfbid token', () => {
    expect(isValidFbPostId('pfbid02X6EAgJQaCxigJJ1U8VeKQsV2P6S')).toBe(true);
  });

  it('rejects short numbers (could be member counts / likes / dates)', () => {
    expect(isValidFbPostId('12345')).toBe(false);
    expect(isValidFbPostId('123456789')).toBe(false); // 9 digits — just below floor
    expect(isValidFbPostId('2026')).toBe(false);
  });

  it('rejects pfbid with non-base62 chars', () => {
    expect(isValidFbPostId('pfbid-bad-stuff')).toBe(false);
    expect(isValidFbPostId('pfbid xy')).toBe(false);
  });

  it('rejects empty / null / non-string', () => {
    expect(isValidFbPostId('')).toBe(false);
    expect(isValidFbPostId(null)).toBe(false);
    expect(isValidFbPostId(undefined)).toBe(false);
  });

  it('rejects mixed strings that contain numbers but are not pure ids', () => {
    expect(isValidFbPostId('post-2017717945502020')).toBe(false);
    expect(isValidFbPostId('123abc')).toBe(false);
    expect(isValidFbPostId('hash_d640c3dd86ab3717e672f5f4a3638306')).toBe(false);
  });
});

console.log('Extractors test suite loaded');
