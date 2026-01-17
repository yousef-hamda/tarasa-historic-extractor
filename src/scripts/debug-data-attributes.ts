/**
 * Debug script to find data attributes that might contain post IDs
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== DATA ATTRIBUTES DEBUG ===\n');

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

  // Scroll to load content
  for (let i = 0; i < 5; i++) {
    await page.evaluate('window.scrollBy(0, 1000)');
    await page.waitForTimeout(1500);
  }

  console.log('\n2. Looking for data attributes containing IDs...\n');

  const analysis = await page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return { error: 'No feed found' };

    // Look for any data-* attributes that might contain post IDs
    const dataAttributes: Array<{
      element: string;
      attribute: string;
      value: string;
      nearbyText: string;
    }> = [];

    // Search all elements in feed for interesting data attributes
    const allElements = feed.querySelectorAll('*');
    for (const el of allElements) {
      const attrs = el.attributes;
      for (let i = 0; i < attrs.length; i++) {
        const attr = attrs[i];
        if (attr.name.startsWith('data-') || attr.name === 'id') {
          const value = attr.value;
          // Look for numeric IDs that might be post IDs
          if (value && (
            value.match(/^\d{10,}$/) ||  // Pure numeric IDs
            value.includes('post') ||
            value.includes('story') ||
            value.includes('feed') ||
            attr.name.includes('ft') ||
            attr.name.includes('id')
          )) {
            // Get nearby text for context
            let nearbyText = '';
            const textEl = el.querySelector('div[dir="auto"]');
            if (textEl) {
              nearbyText = ((textEl as HTMLElement).innerText || '').substring(0, 50);
            }

            dataAttributes.push({
              element: el.tagName.toLowerCase(),
              attribute: attr.name,
              value: value.substring(0, 100),
              nearbyText
            });
          }
        }
      }
    }

    // Also look for __ft__ style objects in links
    const linksWithFt: Array<{
      href: string;
      ftParam: string | null;
    }> = [];

    const allLinks = feed.querySelectorAll('a[href]');
    for (const link of allLinks) {
      const href = link.getAttribute('href') || '';
      if (href.includes('__cft__')) {
        const match = href.match(/__cft__\[0\]=([^&]+)/);
        linksWithFt.push({
          href: href.substring(0, 80),
          ftParam: match ? match[1].substring(0, 50) : null
        });
      }
    }

    // Check for data-pagelet attributes
    const pagelets = feed.querySelectorAll('[data-pagelet]');
    const pageletInfo: Array<{
      pagelet: string;
      hasPostContent: boolean;
    }> = [];

    for (const el of pagelets) {
      const pagelet = el.getAttribute('data-pagelet') || '';
      const hasText = !!el.querySelector('div[dir="auto"]');
      pageletInfo.push({
        pagelet,
        hasPostContent: hasText
      });
    }

    return {
      totalDataAttrs: dataAttributes.length,
      dataAttributes: dataAttributes.slice(0, 30),
      linksWithFt: linksWithFt.slice(0, 10),
      pagelets: pageletInfo.slice(0, 10)
    };
  });

  if ('error' in analysis) {
    console.log('Error:', analysis.error);
    await browser.close();
    return;
  }

  console.log(`Found ${analysis.totalDataAttrs} interesting data attributes\n`);

  console.log('=== DATA ATTRIBUTES ===');
  for (const attr of analysis.dataAttributes.slice(0, 20)) {
    console.log(`  <${attr.element} ${attr.attribute}="${attr.value}">`);
    if (attr.nearbyText) {
      console.log(`    nearby: "${attr.nearbyText}..."`);
    }
  }

  console.log('\n=== LINKS WITH __cft__ ===');
  for (const link of analysis.linksWithFt.slice(0, 5)) {
    console.log(`  ${link.href}...`);
    console.log(`    ft: ${link.ftParam}`);
  }

  console.log('\n=== PAGELETS ===');
  for (const p of analysis.pagelets) {
    console.log(`  ${p.pagelet} (has content: ${p.hasPostContent})`);
  }

  // Save analysis
  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'data-attributes-analysis.json'),
    JSON.stringify(analysis, null, 2)
  );

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
