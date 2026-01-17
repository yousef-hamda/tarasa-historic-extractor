/**
 * Debug script to analyze post URL patterns in Facebook DOM
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== POST URL DEBUG ===\n');

  // Clean up lock files
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

  console.log('2. Waiting for initial load...');
  await page.waitForTimeout(5000);

  // Dismiss popups
  console.log('3. Dismissing popups...');
  try {
    const closeButtons = await page.$$('[aria-label="Close"], div[role="dialog"] [aria-label="Close"]');
    for (const btn of closeButtons.slice(0, 3)) {
      try { await btn.click(); await page.waitForTimeout(500); console.log('   - Dismissed a popup'); } catch {}
    }
  } catch {}

  // Click Discussion tab
  console.log('4. Clicking Discussion tab...');
  try {
    const discussionTab = await page.$('a:has-text("Discussion")');
    if (discussionTab) {
      await discussionTab.click();
      await page.waitForTimeout(3000);
      console.log('   - Clicked Discussion tab');
    }
  } catch {}

  // Scroll to load content
  console.log('5. Scrolling to load content...');
  await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(1000);

  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.scrollBy(0, 1000)');
    await page.waitForTimeout(1500);
  }

  // Analyze links in the page
  console.log('\n6. Analyzing ALL links in the page...');
  const linkAnalysis = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return { error: 'No feed found' };

    // Find all links in feed
    const allLinks = feed.querySelectorAll('a[href]');
    const linkData: Array<{
      href: string;
      text: string;
      containsPostId: boolean;
      type: string;
    }> = [];

    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      const text = (link as HTMLElement).innerText?.trim().substring(0, 50) || '';

      // Categorize the link
      let type = 'other';
      let containsPostId = false;

      if (href.includes('/posts/')) {
        type = 'posts';
        containsPostId = true;
      } else if (href.includes('/permalink/')) {
        type = 'permalink';
        containsPostId = true;
      } else if (href.includes('story_fbid=')) {
        type = 'story_fbid';
        containsPostId = true;
      } else if (href.includes('pfbid')) {
        type = 'pfbid';
        containsPostId = true;
      } else if (href.includes('/user/')) {
        type = 'user_profile';
      } else if (href.includes('profile.php')) {
        type = 'profile.php';
      } else if (href.includes('/groups/')) {
        type = 'groups';
        // Check if it's a post link in groups format
        if (href.match(/\/groups\/\d+\/posts\/\d+/)) {
          containsPostId = true;
        }
      }

      // Only add interesting links (not duplicates)
      if (containsPostId || type !== 'other') {
        const exists = linkData.some(l => l.href === href);
        if (!exists) {
          linkData.push({ href, text, containsPostId, type });
        }
      }
    }

    // Sort by type
    linkData.sort((a, b) => {
      if (a.containsPostId && !b.containsPostId) return -1;
      if (!a.containsPostId && b.containsPostId) return 1;
      return a.type.localeCompare(b.type);
    });

    return {
      totalLinks: allLinks.length,
      categorizedLinks: linkData.length,
      linksWithPostId: linkData.filter(l => l.containsPostId).length,
      links: linkData.slice(0, 50) // Limit to first 50
    };
  });

  console.log('\nLink analysis results:');
  console.log(`Total links in feed: ${linkAnalysis.totalLinks}`);
  console.log(`Categorized links: ${linkAnalysis.categorizedLinks}`);
  console.log(`Links with post IDs: ${linkAnalysis.linksWithPostId}`);

  if ('links' in linkAnalysis && linkAnalysis.links) {
    console.log('\n--- POST ID LINKS ---');
    const postIdLinks = linkAnalysis.links.filter((l: { containsPostId: boolean }) => l.containsPostId);
    for (const link of postIdLinks) {
      console.log(`  [${link.type}] "${link.text}" -> ${link.href.substring(0, 100)}...`);
    }

    console.log('\n--- ALL CATEGORIZED LINKS (first 20) ---');
    for (const link of linkAnalysis.links.slice(0, 20)) {
      console.log(`  [${link.type}] "${link.text}" -> ${link.href.substring(0, 80)}...`);
    }
  }

  // Now analyze what links are near text content
  console.log('\n\n7. Analyzing links NEAR post text content...');
  const textWithLinks = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return [];

    const results: Array<{
      textPreview: string;
      textLength: number;
      nearbyLinks: Array<{
        href: string;
        text: string;
        type: string;
        distance: number;
      }>;
    }> = [];

    // Find substantial text elements
    const textElements = feed.querySelectorAll('div[dir="auto"]');

    for (const textEl of textElements) {
      const text = (textEl as HTMLElement).innerText?.trim() || '';
      if (text.length < 100) continue;
      if (text.match(/^(Like|Comment|Share|Reply|See more)/i)) continue;

      // Skip comments
      const parentArticle = textEl.closest('div[role="article"]');
      if (parentArticle && (parentArticle.getAttribute('aria-label') || '').toLowerCase().includes('comment')) {
        continue;
      }

      const textRect = textEl.getBoundingClientRect();

      // Find container that holds both text and potential links
      let container = textEl.parentElement;
      for (let i = 0; i < 10 && container; i++) {
        if (container.getAttribute('role') === 'feed') break;
        const hasProfileLink = !!container.querySelector('a[href*="/user/"]');
        if (hasProfileLink) break;
        container = container.parentElement;
      }

      if (!container) continue;

      // Find all links in this container
      const links = container.querySelectorAll('a[href]');
      const nearbyLinks: Array<{href: string; text: string; type: string; distance: number;}> = [];

      for (const link of links) {
        const href = link.getAttribute('href') || '';
        const linkText = (link as HTMLElement).innerText?.trim().substring(0, 30) || '';
        const linkRect = link.getBoundingClientRect();

        // Calculate distance from text
        const distance = Math.abs(linkRect.top - textRect.top);

        let type = 'other';
        if (href.includes('/posts/')) type = 'posts';
        else if (href.includes('/permalink/')) type = 'permalink';
        else if (href.includes('story_fbid=')) type = 'story_fbid';
        else if (href.includes('pfbid')) type = 'pfbid';
        else if (href.includes('/user/')) type = 'user';
        else if (href.match(/\/groups\/\d+\/posts\//)) type = 'groups/posts';
        else if (href.match(/\/\d+[hdwmy]$/) || linkText.match(/^\d+[hdwmy]$/)) type = 'timestamp?';

        // Only include relevant link types
        if (type !== 'other' && type !== 'user') {
          nearbyLinks.push({
            href: href.substring(0, 120),
            text: linkText,
            type,
            distance
          });
        }
      }

      // Sort by distance
      nearbyLinks.sort((a, b) => a.distance - b.distance);

      results.push({
        textPreview: text.substring(0, 60),
        textLength: text.length,
        nearbyLinks: nearbyLinks.slice(0, 5)
      });

      if (results.length >= 5) break;
    }

    return results;
  });

  console.log('\nText elements with nearby links:');
  for (let i = 0; i < textWithLinks.length; i++) {
    const item = textWithLinks[i];
    console.log(`\n--- TEXT ${i + 1} ---`);
    console.log(`  Preview: "${item.textPreview}..."`);
    console.log(`  Length: ${item.textLength} chars`);
    console.log(`  Nearby links (${item.nearbyLinks.length}):`);
    for (const link of item.nearbyLinks) {
      console.log(`    [${link.type}] dist=${link.distance}px "${link.text}" -> ${link.href}`);
    }
  }

  // Look for timestamp elements specifically
  console.log('\n\n8. Looking for timestamp elements (these often link to posts)...');
  const timestamps = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return [];

    const results: Array<{
      text: string;
      href: string | null;
      ariaLabel: string | null;
    }> = [];

    // Common timestamp patterns
    const timestampPatterns = [
      /^\d+\s*(h|d|w|m|y)$/i,  // "5d", "2h", etc.
      /^just now$/i,
      /^yesterday$/i,
      /^\d+\s*(hour|day|week|month|year)s?\s*ago$/i
    ];

    // Find all potential timestamp elements
    const elements = feed.querySelectorAll('a, span, abbr');

    for (const el of elements) {
      const text = (el as HTMLElement).innerText?.trim().toLowerCase() || '';
      const isTimestamp = timestampPatterns.some(p => p.test(text));

      if (isTimestamp || (text.length < 10 && text.match(/\d/))) {
        const href = el.tagName === 'A' ? el.getAttribute('href') : null;
        const ariaLabel = el.getAttribute('aria-label');

        // Check if this is interesting (has href or aria-label with date)
        if (href || (ariaLabel && ariaLabel.length > 5)) {
          results.push({
            text,
            href: href?.substring(0, 100) || null,
            ariaLabel
          });
        }
      }
    }

    // Dedupe
    const unique: typeof results = [];
    for (const r of results) {
      if (!unique.some(u => u.text === r.text && u.href === r.href)) {
        unique.push(r);
      }
    }

    return unique.slice(0, 20);
  });

  console.log(`Found ${timestamps.length} potential timestamp elements:`);
  for (const ts of timestamps) {
    console.log(`  "${ts.text}" -> ${ts.href || 'no href'} ${ts.ariaLabel ? `(aria: ${ts.ariaLabel})` : ''}`);
  }

  // Save full analysis to file
  const fullAnalysis = { linkAnalysis, textWithLinks, timestamps };
  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'post-url-analysis.json'),
    JSON.stringify(fullAnalysis, null, 2)
  );
  console.log('\nFull analysis saved to debug-output/post-url-analysis.json');

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
