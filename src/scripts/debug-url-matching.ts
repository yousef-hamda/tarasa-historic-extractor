/**
 * Debug script to understand URL-to-post matching
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== URL MATCHING DEBUG ===\n');

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

  // Dismiss popups and click Discussion tab
  try {
    const closeButtons = await page.$$('[aria-label="Close"]');
    for (const btn of closeButtons.slice(0, 2)) {
      try { await btn.click(); await page.waitForTimeout(500); } catch {}
    }
  } catch {}

  try {
    const discussionTab = await page.$('a:has-text("Discussion")');
    if (discussionTab) {
      await discussionTab.click();
      await page.waitForTimeout(3000);
    }
  } catch {}

  // Scroll
  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.scrollBy(0, 1000)');
    await page.waitForTimeout(1500);
  }

  console.log('\n3. Analyzing spatial relationships...\n');

  const analysis = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return { error: 'No feed found' };

    // Collect ALL post/permalink links with their positions
    const postLinks: Array<{
      y: number;
      href: string;
      text: string;
      isComment: boolean;  // Has comment_id in URL
      postId: string | null;
    }> = [];

    const allPostLinks = feed.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]');
    for (const link of allPostLinks) {
      const rect = link.getBoundingClientRect();
      const href = link.getAttribute('href') || '';
      const text = (link as HTMLElement).innerText?.trim() || '';
      const isComment = href.includes('comment_id');

      // Extract post ID from URL
      const postIdMatch = href.match(/\/posts\/(\d+)/);
      const postId = postIdMatch ? postIdMatch[1] : null;

      postLinks.push({
        y: rect.top,
        href,
        text,
        isComment,
        postId
      });
    }

    // Collect text elements with their positions
    const textElements: Array<{
      y: number;
      textPreview: string;
      textLength: number;
    }> = [];

    const allDirAuto = feed.querySelectorAll('div[dir="auto"]');
    for (const el of allDirAuto) {
      const text = (el as HTMLElement).innerText?.trim() || '';
      if (text.length < 80) continue;
      if (text.match(/^(Like|Comment|Share|Reply|See more)/i)) continue;

      // Skip comments
      const parentArticle = el.closest('div[role="article"]');
      if (parentArticle && (parentArticle.getAttribute('aria-label') || '').toLowerCase().includes('comment')) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      textElements.push({
        y: rect.top,
        textPreview: text.substring(0, 50),
        textLength: text.length
      });
    }

    // Sort both by Y
    postLinks.sort((a, b) => a.y - b.y);
    textElements.sort((a, b) => a.y - b.y);

    // For each text element, find ALL nearby post links (within 300px)
    const matches: Array<{
      textPreview: string;
      textY: number;
      nearbyLinks: Array<{
        href: string;
        text: string;
        y: number;
        distance: number;
        isComment: boolean;
        postId: string | null;
      }>;
    }> = [];

    for (const textEl of textElements) {
      const nearbyLinks = postLinks
        .filter(link => Math.abs(link.y - textEl.y) < 300)
        .map(link => ({
          href: link.href.substring(0, 100),
          text: link.text,
          y: link.y,
          distance: Math.round(link.y - textEl.y),
          isComment: link.isComment,
          postId: link.postId
        }))
        .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));

      matches.push({
        textPreview: textEl.textPreview,
        textY: Math.round(textEl.y),
        nearbyLinks
      });
    }

    return {
      totalPostLinks: postLinks.length,
      totalTextElements: textElements.length,
      postLinks: postLinks.map(l => ({
        y: Math.round(l.y),
        text: l.text,
        postId: l.postId,
        isComment: l.isComment
      })),
      matches
    };
  });

  if ('error' in analysis) {
    console.log('Error:', analysis.error);
    await browser.close();
    return;
  }

  console.log(`Total post links: ${analysis.totalPostLinks}`);
  console.log(`Total text elements: ${analysis.totalTextElements}`);

  console.log('\n=== POST LINKS (sorted by Y position) ===');
  for (const link of analysis.postLinks) {
    console.log(`  Y=${link.y} "${link.text}" postId=${link.postId} ${link.isComment ? '(COMMENT)' : '(MAIN POST)'}`);
  }

  console.log('\n=== TEXT-TO-LINK MATCHES ===');
  for (const match of analysis.matches) {
    console.log(`\nText (Y=${match.textY}): "${match.textPreview}..."`);
    if (match.nearbyLinks.length === 0) {
      console.log('  NO NEARBY LINKS!');
    } else {
      for (const link of match.nearbyLinks.slice(0, 3)) {
        console.log(`  dist=${link.distance}px "${link.text}" postId=${link.postId} ${link.isComment ? '(COMMENT)' : ''}`);
      }
    }
  }

  // Save analysis
  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'url-matching-analysis.json'),
    JSON.stringify(analysis, null, 2)
  );

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
