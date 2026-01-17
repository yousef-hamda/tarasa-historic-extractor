/**
 * Debug script to see what data is actually captured from GraphQL responses
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

interface CapturedPost {
  postId: string;
  fullText: string;
  authorName?: string;
  source: string;
}

async function main() {
  console.log('\n=== GRAPHQL INTERCEPTION DEBUG ===\n');

  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const file of lockFiles) {
    try { await fs.unlink(path.join(BROWSER_DATA_DIR, file)); } catch {}
  }

  await fs.mkdir(DEBUG_OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: true,
    viewport: { width: 1280, height: 900 },
  });

  const page = await browser.newPage();
  const capturedPosts: CapturedPost[] = [];
  const rawResponses: Array<{ url: string; dataPreview: string }> = [];

  // Setup GraphQL interception
  console.log('1. Setting up GraphQL interception...');

  await page.route('**/api/graphql/**', async (route, request) => {
    const response = await route.fetch();

    try {
      const responseBody = await response.text();

      // Save raw response info for debugging
      rawResponses.push({
        url: request.url().substring(0, 100),
        dataPreview: responseBody.substring(0, 500)
      });

      // Try to parse and find post data
      const jsonStrings = responseBody.split('\n').filter(line => line.trim().startsWith('{'));

      for (const jsonStr of jsonStrings) {
        try {
          const data = JSON.parse(jsonStr);
          findPostData(data, capturedPosts, 0);
        } catch {}
      }
    } catch (e) {
      console.log('Parse error:', (e as Error).message);
    }

    await route.fulfill({ response });
  });

  console.log('2. Navigating to group...');
  await page.goto('https://www.facebook.com/groups/1654282231298043', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.waitForTimeout(3000);

  // Click Discussion tab
  try {
    const discussionTab = await page.$('a:has-text("Discussion")');
    if (discussionTab) {
      await discussionTab.click();
      await page.waitForTimeout(3000);
    }
  } catch {}

  // Scroll to trigger more GraphQL requests
  console.log('3. Scrolling to load content...');
  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.scrollBy(0, 1000)');
    await page.waitForTimeout(1500);
    console.log(`   Scroll ${i + 1}/5, captured ${capturedPosts.length} posts so far`);
  }

  // Wait a bit more for responses
  await page.waitForTimeout(2000);

  console.log(`\n=== RESULTS ===`);
  console.log(`Total GraphQL responses: ${rawResponses.length}`);
  console.log(`Posts captured with IDs: ${capturedPosts.filter(p => p.postId).length}`);
  console.log(`Posts captured total: ${capturedPosts.length}`);

  if (capturedPosts.length > 0) {
    console.log('\n=== CAPTURED POSTS ===');
    for (let i = 0; i < Math.min(capturedPosts.length, 10); i++) {
      const post = capturedPosts[i];
      console.log(`\nPost ${i + 1}:`);
      console.log(`  ID: ${post.postId || 'NONE'}`);
      console.log(`  Author: ${post.authorName || 'Unknown'}`);
      console.log(`  Source: ${post.source}`);
      console.log(`  Text preview: ${post.fullText.substring(0, 60)}...`);
    }
  }

  // Save detailed data
  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'graphql-capture.json'),
    JSON.stringify({
      capturedPosts,
      rawResponseCount: rawResponses.length,
      sampleResponses: rawResponses.slice(0, 5)
    }, null, 2)
  );

  await browser.close();
  console.log('\nData saved to debug-output/graphql-capture.json');
}

/**
 * Recursively search for post data in GraphQL response
 */
function findPostData(obj: any, posts: CapturedPost[], depth: number): void {
  if (depth > 25 || !obj || typeof obj !== 'object') return;

  // ID fields to check
  const idFields = [
    'id', 'post_id', 'story_id', 'feedback_id', 'top_level_post_id',
    'mf_story_key', 'story_fbid', 'legacy_story_hideable_id', 'shareable_id'
  ];

  // Extract post ID
  let postId = '';
  for (const field of idFields) {
    if (obj[field]) {
      const value = String(obj[field]);
      if (value.match(/^\d{10,}$/) || value.startsWith('pfbid')) {
        postId = value;
        break;
      }
    }
  }

  // Check for message text
  const textFields = ['message', 'text', 'body', 'content'];
  for (const field of textFields) {
    if (obj[field]) {
      let fullText = '';

      if (typeof obj[field] === 'object' && obj[field].text) {
        fullText = obj[field].text;
      } else if (typeof obj[field] === 'string' && obj[field].length > 50) {
        fullText = obj[field];
      }

      if (fullText && fullText.length > 30) {
        // Extract author
        let authorName = '';
        if (obj.author?.name) authorName = obj.author.name;
        else if (obj.actor?.name) authorName = obj.actor.name;
        else if (obj.owning_profile?.name) authorName = obj.owning_profile.name;

        posts.push({
          postId: postId || extractIdFromObj(obj),
          fullText,
          authorName,
          source: `${field} field at depth ${depth}`
        });

        if (postId) {
          console.log(`   Captured: ID=${postId}, text="${fullText.substring(0, 40)}..."`);
        }
      }
    }
  }

  // Check comet_sections
  if (obj.comet_sections?.content?.story?.message?.text) {
    const text = obj.comet_sections.content.story.message.text;
    const id = extractIdFromObj(obj) || extractIdFromObj(obj.comet_sections?.content?.story || {});
    posts.push({
      postId: id,
      fullText: text,
      source: 'comet_sections'
    });
  }

  // Recurse
  if (Array.isArray(obj)) {
    for (const item of obj) {
      findPostData(item, posts, depth + 1);
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (obj[key] && typeof obj[key] === 'object') {
        findPostData(obj[key], posts, depth + 1);
      }
    }
  }
}

function extractIdFromObj(obj: any): string {
  const idFields = [
    'id', 'post_id', 'story_id', 'feedback_id', 'top_level_post_id',
    'mf_story_key', 'story_fbid', 'legacy_story_hideable_id'
  ];

  for (const field of idFields) {
    if (obj[field]) {
      const value = String(obj[field]);
      if (value.match(/^\d{10,}$/) || value.startsWith('pfbid')) {
        return value;
      }
    }
  }

  if (obj.feedback?.id) return obj.feedback.id;
  if (obj.story?.id) return obj.story.id;

  return '';
}

main().catch(console.error);
