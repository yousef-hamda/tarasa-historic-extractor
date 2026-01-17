/**
 * Test Script: Full Text Extraction
 *
 * This script tests the enhanced full text extraction capabilities
 * to verify that "See more" buttons are properly expanded and
 * complete post text is captured.
 *
 * Usage: npx ts-node src/scripts/test-full-text.ts [groupId]
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import logger from '../utils/logger';
import {
  expandAllSeeMoreButtons,
  setupPostInterception,
  clearInterceptedCache,
  getInterceptedFullText,
} from '../scraper/fullTextExtractor';
import { extractPosts } from '../scraper/extractors';
import { loadCookies } from '../facebook/session';
import path from 'path';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');

const testGroupId = process.argv[2] || process.env.GROUP_IDS?.split(',')[0] || '';

if (!testGroupId) {
  console.error('Error: Please provide a group ID as argument or set GROUP_IDS env var');
  console.error('Usage: npx ts-node src/scripts/test-full-text.ts GROUP_ID');
  process.exit(1);
}

async function testFullTextExtraction() {
  console.log('\n=== FULL TEXT EXTRACTION TEST ===\n');
  console.log(`Testing group: ${testGroupId}`);

  let browser: BrowserContext | null = null;

  try {
    // Launch browser with persistent profile
    console.log('\n1. Launching browser with persistent profile...');

    // Clean up lock files first
    const fs = await import('fs/promises');
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
    for (const file of lockFiles) {
      try {
        await fs.unlink(path.join(BROWSER_DATA_DIR, file));
      } catch {}
    }

    browser = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      headless: true, // Use headless mode for testing
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // Setup network interception
    console.log('\n2. Setting up GraphQL interception...');
    clearInterceptedCache();
    await setupPostInterception(page);

    // Navigate to group
    const groupUrl = `https://www.facebook.com/groups/${testGroupId}`;
    console.log(`\n3. Navigating to: ${groupUrl}`);
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Wait for feed to load
    console.log('\n4. Waiting for feed to load...');
    try {
      await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
      console.log('   ✓ Feed container found');
    } catch {
      console.log('   ⚠ Feed container not found, trying articles...');
      await page.waitForSelector('div[role="article"]', { timeout: 10000 });
    }

    // Scroll to load more posts
    console.log('\n5. Scrolling to load posts...');
    for (let i = 0; i < 5; i++) {
      await page.evaluate('window.scrollBy(0, 1500)');
      await page.waitForTimeout(1000);
      const articleCount = await page.evaluate(() =>
        document.querySelectorAll('div[role="article"]').length
      );
      console.log(`   Scroll ${i + 1}/5 - Found ${articleCount} articles`);
    }

    // Count "See more" buttons BEFORE expansion
    const beforeCount = await page.evaluate(() => {
      const patterns = ['See more', 'ראה עוד', 'عرض المزيد', '...more'];
      let count = 0;
      document.querySelectorAll('[role="button"], span, div').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim() || '';
        if (patterns.some(p => text.toLowerCase().includes(p.toLowerCase()))) {
          count++;
        }
      });
      return count;
    });
    console.log(`\n6. Found ${beforeCount} "See more" buttons BEFORE expansion`);

    // Expand all "See more" buttons
    console.log('\n7. Expanding all "See more" buttons...');
    const expandedCount = await expandAllSeeMoreButtons(page);
    console.log(`   ✓ Expanded ${expandedCount} buttons`);

    // Wait for expansion
    await page.waitForTimeout(1500);

    // Count "See more" buttons AFTER expansion
    const afterCount = await page.evaluate(() => {
      const patterns = ['See more', 'ראה עוד', 'عرض المزيد', '...more'];
      let count = 0;
      document.querySelectorAll('[role="button"], span, div').forEach(el => {
        const text = (el as HTMLElement).innerText?.trim() || '';
        if (patterns.some(p => text.toLowerCase().includes(p.toLowerCase()))) {
          count++;
        }
      });
      return count;
    });
    console.log(`   "See more" buttons remaining after expansion: ${afterCount}`);

    // Debug: Check page structure
    console.log('\n7.5 Debugging page structure...');
    const pageInfo = await page.evaluate(() => {
      const url = window.location.href;
      const title = document.title;
      const feedContainer = document.querySelector('div[role="feed"]');
      const articles = document.querySelectorAll('div[role="article"]');
      const dirAutos = document.querySelectorAll('div[dir="auto"]');
      const hasLoginForm = !!document.querySelector('input[name="email"]');
      let hasJoinButton = false;
      const buttons = document.querySelectorAll('[role="button"]');
      for (const btn of buttons) {
        if ((btn as HTMLElement).innerText?.includes('Join')) {
          hasJoinButton = true;
          break;
        }
      }

      // Get sample text content
      let sampleText = '';
      for (const div of dirAutos) {
        const text = (div as HTMLElement).innerText || '';
        if (text.length > 100 && text.length < 500) {
          sampleText = text.substring(0, 200);
          break;
        }
      }

      return {
        url,
        title,
        hasFeed: !!feedContainer,
        articleCount: articles.length,
        dirAutoCount: dirAutos.length,
        hasLoginForm,
        hasJoinButton,
        sampleText
      };
    });

    console.log(`   URL: ${pageInfo.url}`);
    console.log(`   Title: ${pageInfo.title}`);
    console.log(`   Has feed container: ${pageInfo.hasFeed}`);
    console.log(`   Article count: ${pageInfo.articleCount}`);
    console.log(`   dir="auto" divs: ${pageInfo.dirAutoCount}`);
    console.log(`   Has login form: ${pageInfo.hasLoginForm}`);
    console.log(`   Has join button: ${pageInfo.hasJoinButton}`);
    if (pageInfo.sampleText) {
      console.log(`   Sample text: "${pageInfo.sampleText}..."`);
    }

    // Take screenshot for debugging
    const screenshotPath = path.join(process.cwd(), 'test-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`   Screenshot saved: ${screenshotPath}`);

    // Extract posts
    console.log('\n8. Extracting posts...');
    const posts = await extractPosts(page, browser);
    console.log(`   ✓ Extracted ${posts.length} posts`);

    // Analyze extracted text
    console.log('\n9. Analyzing extracted text quality:');
    let truncatedCount = 0;
    let fullTextCount = 0;
    let shortPostCount = 0;

    for (let i = 0; i < Math.min(posts.length, 10); i++) {
      const post = posts[i];
      const textLength = post.text.length;
      const isTruncated = post.text.endsWith('…') ||
                          post.text.endsWith('...') ||
                          post.text.includes('See more');

      if (textLength < 100) {
        shortPostCount++;
      } else if (isTruncated) {
        truncatedCount++;
      } else {
        fullTextCount++;
      }

      console.log(`\n   Post ${i + 1}:`);
      console.log(`   - Length: ${textLength} chars`);
      console.log(`   - Status: ${isTruncated ? '⚠ TRUNCATED' : textLength < 100 ? '📝 Short post' : '✓ FULL TEXT'}`);
      console.log(`   - Preview: "${post.text.substring(0, 150)}${textLength > 150 ? '...' : ''}"`);
      if (post.text.length > 150) {
        console.log(`   - Ending: "...${post.text.substring(post.text.length - 100)}"`);
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Total posts extracted: ${posts.length}`);
    console.log(`Full text posts: ${fullTextCount}`);
    console.log(`Truncated posts: ${truncatedCount}`);
    console.log(`Short posts (< 100 chars): ${shortPostCount}`);
    console.log(`"See more" buttons before: ${beforeCount}`);
    console.log(`"See more" buttons after: ${afterCount}`);
    console.log(`Buttons expanded: ${expandedCount}`);

    const successRate = posts.length > 0
      ? ((fullTextCount + shortPostCount) / Math.min(posts.length, 10) * 100).toFixed(1)
      : 0;
    console.log(`\nFull text success rate: ${successRate}%`);

    if (truncatedCount > 0) {
      console.log('\n⚠ Some posts still appear truncated.');
      console.log('   This may require additional debugging or alternative methods.');
    } else {
      console.log('\n✓ All posts have full text!');
    }

    // Close browser
    console.log('\n\nClosing browser...');

  } catch (error) {
    console.error('\n❌ Test failed:', (error as Error).message);
    console.error(error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testFullTextExtraction().then(() => {
  console.log('\nTest completed.');
  process.exit(0);
}).catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
