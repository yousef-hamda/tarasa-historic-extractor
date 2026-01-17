/**
 * Debug script to look for post IDs in page JavaScript data stores
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== PAGE DATA DEBUG ===\n');

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

  console.log('2. Searching for post IDs in page data...\n');

  const analysis = await page.evaluate(() => {
    const results: {
      scriptData: Array<{ type: string; preview: string; hasPostId: boolean }>;
      windowVars: string[];
      potentialIds: string[];
      linkAnalysis: Array<{
        text: string;
        href: string;
        postId: string | null;
      }>;
    } = {
      scriptData: [],
      windowVars: [],
      potentialIds: [],
      linkAnalysis: []
    };

    // Check window variables for Facebook data stores
    const fbVars = ['__facebookEntryPoints', '__RELAY_INTERNAL__', '__fbAjax', 'requireLazy'];
    for (const varName of fbVars) {
      if ((window as any)[varName]) {
        results.windowVars.push(varName);
      }
    }

    // Check script tags for embedded data
    const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
    for (const script of scripts) {
      const content = script.textContent || '';
      if (content.length > 100 && content.length < 50000) {
        // Look for post ID patterns
        const hasPostId = content.includes('post_id') ||
                         content.includes('story_id') ||
                         content.includes('mf_story_key') ||
                         content.includes('feedback_id') ||
                         /"\d{15,}"/.test(content);

        results.scriptData.push({
          type: script.getAttribute('type') || 'inline',
          preview: content.substring(0, 200),
          hasPostId
        });

        // Extract any numeric IDs that look like post IDs
        const idMatches = content.match(/"\d{15,20}"/g);
        if (idMatches) {
          for (const match of idMatches.slice(0, 5)) {
            results.potentialIds.push(match.replace(/"/g, ''));
          }
        }
      }
    }

    // Analyze ALL links on the page that might contain post IDs
    const allLinks = document.querySelectorAll('a[href*="facebook.com"]');
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      const text = (link as HTMLElement).innerText?.trim().substring(0, 30) || '';

      // Check for various post ID patterns in URLs
      const patterns = [
        /\/posts\/(\d+)/,
        /story_fbid=(\d+)/,
        /pfbid=([A-Za-z0-9]+)/,
        /__cft__\[0\]=([^&]+)/,
        /multi_permalinks=(\d+)/
      ];

      let postId: string | null = null;
      for (const pattern of patterns) {
        const match = href.match(pattern);
        if (match) {
          postId = match[1];
          break;
        }
      }

      if (postId || href.includes('/posts/') || href.includes('permalink')) {
        results.linkAnalysis.push({
          text: text || '(no text)',
          href: href.substring(0, 100),
          postId
        });
      }
    }

    // Dedupe linkAnalysis
    const seenHrefs = new Set<string>();
    results.linkAnalysis = results.linkAnalysis.filter(item => {
      if (seenHrefs.has(item.href)) return false;
      seenHrefs.add(item.href);
      return true;
    });

    return results;
  });

  console.log('=== WINDOW VARIABLES ===');
  console.log(`Found FB variables: ${analysis.windowVars.join(', ') || 'None'}`);

  console.log('\n=== SCRIPT DATA ===');
  console.log(`Found ${analysis.scriptData.length} script tags with data`);
  const withPostIds = analysis.scriptData.filter(s => s.hasPostId);
  console.log(`Scripts with potential post IDs: ${withPostIds.length}`);
  for (const s of withPostIds.slice(0, 3)) {
    console.log(`  Type: ${s.type}`);
    console.log(`  Preview: ${s.preview.substring(0, 100)}...`);
  }

  console.log('\n=== POTENTIAL POST IDS ===');
  const uniqueIds = [...new Set(analysis.potentialIds)];
  console.log(`Found ${uniqueIds.length} potential IDs: ${uniqueIds.slice(0, 10).join(', ')}`);

  console.log('\n=== LINK ANALYSIS ===');
  console.log(`Found ${analysis.linkAnalysis.length} unique post-related links`);
  for (const link of analysis.linkAnalysis.slice(0, 15)) {
    console.log(`  [${link.postId || 'NO ID'}] "${link.text}" -> ${link.href.substring(0, 60)}...`);
  }

  // Save full analysis
  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'page-data-analysis.json'),
    JSON.stringify(analysis, null, 2)
  );

  await browser.close();
  console.log('\nAnalysis saved to debug-output/page-data-analysis.json');
}

main().catch(console.error);
