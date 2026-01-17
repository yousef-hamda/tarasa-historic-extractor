/**
 * Test script to verify full extraction including post URLs
 */

import { chromium, BrowserContext } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { extractPosts, ScrapedPost } from '../scraper/extractors';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== FULL EXTRACTION TEST ===\n');

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

  for (let i = 0; i < 6; i++) {
    await page.evaluate('window.scrollBy(0, 1000)');
    await page.waitForTimeout(1500);
  }

  // Run extraction
  console.log('\n6. Running extractPosts()...\n');
  const posts: ScrapedPost[] = await extractPosts(page, browser);

  console.log(`\n=== EXTRACTION RESULTS ===`);
  console.log(`Total posts extracted: ${posts.length}\n`);

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    console.log(`--- POST ${i + 1} ---`);
    console.log(`  ID: ${post.fbPostId}`);
    console.log(`  Author: ${post.authorName || 'NOT FOUND'}`);
    console.log(`  Author Link: ${post.authorLink ? 'YES' : 'NO'}`);
    console.log(`  Author Photo: ${post.authorPhoto ? 'YES' : 'NO'}`);
    console.log(`  Post URL: ${post.postUrl || 'NOT FOUND'}`);
    console.log(`  Text (${post.text.length} chars): ${post.text.substring(0, 80)}...`);
    console.log('');
  }

  // Summary
  const withPostUrl = posts.filter(p => p.postUrl).length;
  const withAuthorName = posts.filter(p => p.authorName).length;
  const withAuthorLink = posts.filter(p => p.authorLink).length;
  const withAuthorPhoto = posts.filter(p => p.authorPhoto).length;

  console.log(`=== SUMMARY ===`);
  console.log(`Total posts: ${posts.length}`);
  console.log(`With post URL: ${withPostUrl} (${Math.round(withPostUrl/posts.length*100 || 0)}%)`);
  console.log(`With author name: ${withAuthorName} (${Math.round(withAuthorName/posts.length*100 || 0)}%)`);
  console.log(`With author link: ${withAuthorLink} (${Math.round(withAuthorLink/posts.length*100 || 0)}%)`);
  console.log(`With author photo: ${withAuthorPhoto} (${Math.round(withAuthorPhoto/posts.length*100 || 0)}%)`);

  // Save results
  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'extraction-results.json'),
    JSON.stringify(posts, null, 2)
  );
  console.log(`\nResults saved to debug-output/extraction-results.json`);

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
