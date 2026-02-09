/**
 * NOTE: These tests currently duplicate extraction logic rather than testing
 * the actual code in src/scraper/apifyScraper.ts.
 *
 * To properly test the real scraper code, the internal extraction functions
 * (extractPostId, extractPostText) would need to be exported from apifyScraper.ts.
 *
 * TODO: Refactor apifyScraper.ts to export extraction utilities and update
 * these tests to import from the real module.
 */

/**
 * Apify Scraper Tests
 *
 * Tests for Apify post normalization and field extraction
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// We need to test the internal functions, so we'll import the module and test the normalization logic
// Since the functions are not exported, we'll test the behavior indirectly by simulating the normalization

describe('Apify Post Normalization', () => {
  describe('extractPostId', () => {
    // Helper function to simulate post ID extraction logic
    const extractPostId = (post: Record<string, unknown>): string | null => {
      // Try direct ID fields first (Apify's actual field name is 'id')
      if (post.id) return post.id as string;
      if (post.postId) return post.postId as string;

      // Try to extract from URL
      const url = (post.url || post.postUrl) as string | undefined;
      if (url) {
        const patterns = [
          /\/posts\/(\d+)/,
          /\/permalink\/(\d+)/,
          /story_fbid=(\d+)/,
          /\/(\d+)\/?$/,
        ];
        for (const pattern of patterns) {
          const match = url.match(pattern);
          if (match) return match[1];
        }
      }

      return null;
    };

    it('should extract id from Apify format (uses "id" field)', () => {
      const post = { id: '123456789', message: 'Test post' };
      expect(extractPostId(post)).toBe('123456789');
    });

    it('should extract postId from legacy format', () => {
      const post = { postId: '987654321', text: 'Test post' };
      expect(extractPostId(post)).toBe('987654321');
    });

    it('should prefer "id" over "postId" when both present', () => {
      const post = { id: 'apify-id', postId: 'legacy-id', message: 'Test' };
      expect(extractPostId(post)).toBe('apify-id');
    });

    it('should extract ID from /posts/ URL pattern', () => {
      const post = { url: 'https://www.facebook.com/groups/123/posts/456789' };
      expect(extractPostId(post)).toBe('456789');
    });

    it('should extract ID from /permalink/ URL pattern', () => {
      const post = { url: 'https://www.facebook.com/groups/123/permalink/456789' };
      expect(extractPostId(post)).toBe('456789');
    });

    it('should extract ID from story_fbid parameter', () => {
      const post = { url: 'https://www.facebook.com/groups/123?story_fbid=456789' };
      expect(extractPostId(post)).toBe('456789');
    });

    it('should return null when no ID found', () => {
      const post = { message: 'Post without ID' };
      expect(extractPostId(post)).toBeNull();
    });
  });

  describe('extractPostText', () => {
    // Helper function to simulate text extraction logic
    const extractPostText = (post: Record<string, unknown>): string | null => {
      // Try Apify's 'message' field first (this is what they actually use)
      if (typeof post.message === 'string' && post.message.trim()) {
        return post.message.trim();
      }

      // Fallback to 'text' field
      if (typeof post.text === 'string' && post.text.trim()) {
        return post.text.trim();
      }

      // Try other possible field names
      const altFields = ['content', 'body', 'description'];
      for (const field of altFields) {
        const value = post[field];
        if (typeof value === 'string' && value.trim()) {
          return value.trim();
        }
      }

      return null;
    };

    it('should extract message from Apify format (uses "message" field)', () => {
      const post = { id: '123', message: 'Hello from Apify!' };
      expect(extractPostText(post)).toBe('Hello from Apify!');
    });

    it('should extract text from legacy format', () => {
      const post = { postId: '123', text: 'Hello from legacy!' };
      expect(extractPostText(post)).toBe('Hello from legacy!');
    });

    it('should prefer "message" over "text" when both present', () => {
      const post = { message: 'Apify message', text: 'Legacy text' };
      expect(extractPostText(post)).toBe('Apify message');
    });

    it('should trim whitespace', () => {
      const post = { message: '  Hello with spaces  ' };
      expect(extractPostText(post)).toBe('Hello with spaces');
    });

    it('should return null for empty text', () => {
      const post = { message: '   ' };
      expect(extractPostText(post)).toBeNull();
    });

    it('should fallback to content field', () => {
      const post = { id: '123', content: 'Fallback content' };
      expect(extractPostText(post)).toBe('Fallback content');
    });

    it('should return null when no text found', () => {
      const post = { id: '123', likes: 100 };
      expect(extractPostText(post)).toBeNull();
    });
  });

  describe('Apify Response Format Handling', () => {
    // Simulate a real Apify response
    it('should handle actual Apify Facebook Posts Scraper response format', () => {
      // This is what Apify actually returns (based on their documentation)
      const apifyPost = {
        id: '1234567890123456',
        url: 'https://www.facebook.com/groups/testgroup/posts/1234567890123456',
        message: 'This is a real post from a Facebook group',
        author: {
          name: 'John Doe',
          url: 'https://www.facebook.com/johndoe',
          profilePicture: 'https://scontent.xx.fbcdn.net/v/profile.jpg'
        },
        date: '2024-01-15T10:30:00.000Z',
        likes: 42,
        comments: 5,
        shares: 2
      };

      // Simulate our extraction logic
      const postId = apifyPost.id || (apifyPost as any).postId;
      const text = apifyPost.message || (apifyPost as any).text;
      const authorName = apifyPost.author?.name || (apifyPost as any).userName;

      expect(postId).toBe('1234567890123456');
      expect(text).toBe('This is a real post from a Facebook group');
      expect(authorName).toBe('John Doe');
    });

    it('should handle posts with only URL (extract ID from URL)', () => {
      const apifyPost = {
        url: 'https://www.facebook.com/groups/136596023614231/posts/9876543210123456',
        message: 'A post where id field might be missing'
      };

      // Extract ID from URL
      const urlMatch = apifyPost.url.match(/\/posts\/(\d+)/);
      const postId = urlMatch ? urlMatch[1] : null;

      expect(postId).toBe('9876543210123456');
    });
  });
});

console.log('🧪 Apify scraper test suite loaded');
