/**
 * Debug script to find ANY hidden post identifiers in the DOM
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== FINDING POST IDENTIFIERS ===\n');

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

  console.log('1. Navigating to group...');
  await page.goto('https://www.facebook.com/groups/1654282231298043', {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  await page.waitForTimeout(5000);

  // Click Discussion tab
  try {
    const discussionTab = await page.$('a:has-text("Discussion")');
    if (discussionTab) {
      await discussionTab.click();
      await page.waitForTimeout(3000);
    }
  } catch {}

  // Scroll
  for (let i = 0; i < 3; i++) {
    await page.evaluate('window.scrollBy(0, 800)');
    await page.waitForTimeout(1000);
  }

  console.log('\n2. Searching for post identifiers...\n');

  const analysis = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return { error: 'No feed found' };

    const results: Array<{
      textPreview: string;
      foundIdentifiers: Array<{
        type: string;
        value: string;
        source: string;
      }>;
      allDataAttributes: Array<{ attr: string; value: string }>;
      allHrefs: string[];
    }> = [];

    // Find text elements (posts)
    const textElements = feed.querySelectorAll('div[dir="auto"]');

    for (const textEl of textElements) {
      const text = (textEl as HTMLElement).innerText?.trim() || '';
      if (text.length < 80) continue;
      if (text.match(/^(Like|Comment|Share|Reply|See more)/i)) continue;

      // Skip comments
      const parentArticle = textEl.closest('div[role="article"]');
      if (parentArticle && (parentArticle.getAttribute('aria-label') || '').toLowerCase().includes('comment')) {
        continue;
      }

      const postData: typeof results[0] = {
        textPreview: text.substring(0, 50),
        foundIdentifiers: [],
        allDataAttributes: [],
        allHrefs: []
      };

      // Walk up to find container with identifiers
      let container = textEl.parentElement;
      for (let i = 0; i < 20 && container; i++) {
        if (container.getAttribute('role') === 'feed') break;

        // Check ALL data attributes
        const attrs = container.attributes;
        for (let j = 0; j < attrs.length; j++) {
          const attr = attrs[j];
          if (attr.name.startsWith('data-') || attr.name === 'id') {
            postData.allDataAttributes.push({
              attr: attr.name,
              value: attr.value.substring(0, 100)
            });

            // Check for potential post IDs
            if (attr.value.match(/^\d{10,}$/)) {
              postData.foundIdentifiers.push({
                type: 'numeric_id',
                value: attr.value,
                source: `${attr.name} on ${container.tagName}`
              });
            }
            if (attr.value.includes('post') || attr.value.includes('story')) {
              postData.foundIdentifiers.push({
                type: 'post_reference',
                value: attr.value.substring(0, 80),
                source: `${attr.name} on ${container.tagName}`
              });
            }
            // Check for JSON with IDs
            if (attr.value.startsWith('{') || attr.value.startsWith('[')) {
              try {
                const parsed = JSON.parse(attr.value);
                const jsonStr = JSON.stringify(parsed);
                if (jsonStr.includes('post_id') || jsonStr.includes('story_id') || jsonStr.includes('mf_story_key')) {
                  postData.foundIdentifiers.push({
                    type: 'json_with_id',
                    value: attr.value.substring(0, 150),
                    source: `${attr.name} on ${container.tagName}`
                  });
                }
              } catch {}
            }
          }
        }

        // Check all links in this container
        const links = container.querySelectorAll('a[href]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          // Look for post IDs in URLs
          const postMatch = href.match(/\/posts\/(\d+)/);
          const storyMatch = href.match(/story_fbid=(\d+)/);
          const pfbidMatch = href.match(/(pfbid[A-Za-z0-9]+)/);

          if (postMatch) {
            postData.foundIdentifiers.push({
              type: 'url_post_id',
              value: postMatch[1],
              source: `href on link: "${(link as HTMLElement).innerText?.substring(0, 20) || 'no text'}"`
            });
            postData.allHrefs.push(href.substring(0, 100));
          }
          if (storyMatch) {
            postData.foundIdentifiers.push({
              type: 'url_story_id',
              value: storyMatch[1],
              source: `href on link`
            });
          }
          if (pfbidMatch) {
            postData.foundIdentifiers.push({
              type: 'url_pfbid',
              value: pfbidMatch[1],
              source: `href on link`
            });
          }
        }

        container = container.parentElement;
      }

      // Dedupe identifiers
      const seen = new Set<string>();
      postData.foundIdentifiers = postData.foundIdentifiers.filter(id => {
        const key = `${id.type}:${id.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (postData.foundIdentifiers.length > 0 || postData.allDataAttributes.length > 0) {
        results.push(postData);
      }

      if (results.length >= 5) break;
    }

    return { posts: results };
  });

  if ('error' in analysis) {
    console.log('Error:', analysis.error);
    await browser.close();
    return;
  }

  console.log(`Found ${analysis.posts.length} posts with potential identifiers:\n`);

  for (let i = 0; i < analysis.posts.length; i++) {
    const post = analysis.posts[i];
    console.log(`=== POST ${i + 1}: "${post.textPreview}..." ===`);

    if (post.foundIdentifiers.length > 0) {
      console.log('  IDENTIFIERS FOUND:');
      for (const id of post.foundIdentifiers) {
        console.log(`    [${id.type}] ${id.value}`);
        console.log(`      Source: ${id.source}`);
      }
    } else {
      console.log('  NO IDENTIFIERS FOUND');
    }

    if (post.allDataAttributes.length > 0) {
      console.log(`  Data attributes (${post.allDataAttributes.length}):`);
      for (const attr of post.allDataAttributes.slice(0, 5)) {
        console.log(`    ${attr.attr}="${attr.value}"`);
      }
    }

    if (post.allHrefs.length > 0) {
      console.log(`  URLs with post IDs:`);
      for (const href of post.allHrefs.slice(0, 3)) {
        console.log(`    ${href}`);
      }
    }
    console.log('');
  }

  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'post-identifiers.json'),
    JSON.stringify(analysis, null, 2)
  );

  await browser.close();
  console.log('Done.');
}

main().catch(console.error);
