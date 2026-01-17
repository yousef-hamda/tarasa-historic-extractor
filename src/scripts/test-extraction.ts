/**
 * Test script to debug extraction issues
 */

import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== EXTRACTION DEBUG TEST ===\n');

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

  // Scroll to top then scroll down
  console.log('5. Scrolling to load content...');
  await page.evaluate('window.scrollTo(0, 0)');
  await page.waitForTimeout(1000);

  for (let i = 0; i < 8; i++) {
    await page.evaluate('window.scrollBy(0, 1000)');
    await page.waitForTimeout(1500);
  }

  // Take screenshot
  await page.screenshot({ path: path.join(DEBUG_OUTPUT_DIR, 'extraction-test.png'), fullPage: false });
  console.log('6. Screenshot saved');

  // Debug extraction
  console.log('\n7. Analyzing page content...');
  const analysis = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return { error: 'No feed found' };

    const allDirAuto = document.querySelectorAll('div[dir="auto"]');

    // Find all text elements that pass our filters
    const textElements: Array<{
      text: string;
      len: number;
      inFeed: boolean;
      inComment: boolean;
      garbled: boolean;
      hasParentWithProfileLink: boolean;
    }> = [];

    for (const el of allDirAuto) {
      const text = (el as HTMLElement).innerText?.trim() || '';

      // Skip short
      if (text.length < 80) continue;

      // Check if in feed
      const inFeed = feed.contains(el);
      if (!inFeed) continue;

      // Check if UI element
      if (text.match(/^(Like|Comment|Share|Reply|See more|See translation|Write a)/i)) continue;
      if (text.includes('See less') && text.length < 150) continue;

      // Check for garbled text
      const lines = text.split('\n').filter(l => l.trim().length > 0);
      let garbled = false;
      if (lines.length > 10) {
        const singleCharLines = lines.filter(l => l.trim().length <= 2).length;
        const ratio = singleCharLines / lines.length;
        if (ratio > 0.7) garbled = true;
      }

      // Check if inside comment
      const parentArticle = el.closest('div[role="article"]');
      const inComment = parentArticle &&
        (parentArticle.getAttribute('aria-label') || '').toLowerCase().includes('comment');

      // Check for parent with profile link
      let hasParentWithProfileLink = false;
      let parent: HTMLElement | null = el as HTMLElement;
      for (let i = 0; i < 20 && parent; i++) {
        if (parent.querySelector('a[href*="/user/"], a[href*="profile.php"]')) {
          hasParentWithProfileLink = true;
          break;
        }
        parent = parent.parentElement;
        if (parent?.getAttribute('role') === 'feed') break;
      }

      textElements.push({
        text: text.substring(0, 60),
        len: text.length,
        inFeed,
        inComment: !!inComment,
        garbled,
        hasParentWithProfileLink
      });
    }

    return {
      feedChildren: feed.children.length,
      totalDirAuto: allDirAuto.length,
      passedFilters: textElements.length,
      elements: textElements
    };
  });

  console.log('\nAnalysis results:');
  console.log(JSON.stringify(analysis, null, 2));

  // Count how many would be extracted
  if (!('error' in analysis)) {
    const validPosts = analysis.elements.filter(e => !e.inComment && !e.garbled);
    console.log(`\n=> Valid posts (not comment, not garbled): ${validPosts.length}`);

    // Check for duplicates
    const seen = new Set<string>();
    let unique = 0;
    for (const el of validPosts) {
      const key = el.text.substring(0, 50);
      if (!seen.has(key)) {
        seen.add(key);
        unique++;
        console.log(`   ${unique}. "${el.text}..." (${el.len} chars)`);
      }
    }
    console.log(`=> Unique valid posts: ${unique}`);
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
