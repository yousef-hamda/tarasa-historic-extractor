/**
 * Debug script to investigate why wrong authors are being extracted
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs/promises';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const DEBUG_OUTPUT_DIR = path.resolve(process.cwd(), 'debug-output');

async function main() {
  console.log('\n=== AUTHOR EXTRACTION DEBUG ===\n');

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

  console.log('\n2. Analyzing ALL profile links on the page...\n');

  const analysis = await page.evaluate(() => {
    const results: {
      loggedInUser: {
        name: string | null;
        id: string | null;
        photoUrl: string | null;
      };
      allProfileLinks: Array<{
        name: string;
        href: string;
        userId: string | null;
        location: string;
        y: number;
        isInFeed: boolean;
        isInSidebar: boolean;
        isInHeader: boolean;
      }>;
      textElementsWithNearbyProfiles: Array<{
        textPreview: string;
        textY: number;
        nearbyProfiles: Array<{
          name: string;
          userId: string | null;
          distance: number;
          direction: string;
        }>;
      }>;
    } = {
      loggedInUser: { name: null, id: null, photoUrl: null },
      allProfileLinks: [],
      textElementsWithNearbyProfiles: []
    };

    // Find logged-in user info (usually in header or sidebar)
    // Look for profile links in the navigation/header area
    const headerArea = document.querySelector('[role="banner"], [role="navigation"]');
    if (headerArea) {
      const userLinks = headerArea.querySelectorAll('a[href*="/user/"], a[href*="profile.php"]');
      for (const link of userLinks) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/user\/(\d+)/) || href.match(/profile\.php\?id=(\d+)/);
        if (match) {
          results.loggedInUser.id = match[1];
          results.loggedInUser.name = link.getAttribute('aria-label') ||
            (link as HTMLElement).innerText?.trim() || null;
          break;
        }
      }
    }

    // Also check for user avatar in header
    const headerPhotos = document.querySelectorAll('[role="banner"] svg image, [role="navigation"] svg image');
    for (const img of headerPhotos) {
      const href = img.getAttribute('href');
      if (href && (href.includes('scontent') || href.includes('fbcdn'))) {
        results.loggedInUser.photoUrl = href;
        break;
      }
    }

    const feed = document.querySelector('div[role="feed"]');
    const sidebar = document.querySelector('[role="complementary"]');

    // Collect ALL profile links on page
    const allProfileLinks = document.querySelectorAll('a[href*="/user/"], a[href*="profile.php"]');

    for (const link of allProfileLinks) {
      const href = link.getAttribute('href') || '';
      const rect = link.getBoundingClientRect();
      const name = link.getAttribute('aria-label') || (link as HTMLElement).innerText?.trim() || '';

      // Extract user ID
      const match = href.match(/\/user\/(\d+)/) || href.match(/profile\.php\?id=(\d+)/);
      const userId = match ? match[1] : null;

      // Determine location
      let location = 'unknown';
      let isInFeed = false;
      let isInSidebar = false;
      let isInHeader = false;

      if (feed && feed.contains(link)) {
        location = 'feed';
        isInFeed = true;
      } else if (sidebar && sidebar.contains(link)) {
        location = 'sidebar';
        isInSidebar = true;
      } else if (rect.top < 100) {
        location = 'header';
        isInHeader = true;
      } else {
        location = 'other';
      }

      results.allProfileLinks.push({
        name: name.substring(0, 50),
        href: href.substring(0, 80),
        userId,
        location,
        y: Math.round(rect.top),
        isInFeed,
        isInSidebar,
        isInHeader
      });
    }

    // Find text elements and their nearby profile links
    if (feed) {
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

        const textRect = textEl.getBoundingClientRect();

        // Find nearby profile links
        const nearbyProfiles: Array<{
          name: string;
          userId: string | null;
          distance: number;
          direction: string;
        }> = [];

        for (const profileData of results.allProfileLinks) {
          if (!profileData.isInFeed) continue; // Only consider profiles in feed

          const distance = profileData.y - textRect.top;

          // Only consider profiles within 300px
          if (Math.abs(distance) < 300) {
            nearbyProfiles.push({
              name: profileData.name,
              userId: profileData.userId,
              distance: Math.round(distance),
              direction: distance < 0 ? 'ABOVE' : 'BELOW'
            });
          }
        }

        // Sort by distance (absolute)
        nearbyProfiles.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance));

        results.textElementsWithNearbyProfiles.push({
          textPreview: text.substring(0, 50),
          textY: Math.round(textRect.top),
          nearbyProfiles: nearbyProfiles.slice(0, 5)
        });

        if (results.textElementsWithNearbyProfiles.length >= 5) break;
      }
    }

    return results;
  });

  console.log('=== LOGGED-IN USER ===');
  console.log(`  Name: ${analysis.loggedInUser.name}`);
  console.log(`  ID: ${analysis.loggedInUser.id}`);
  console.log(`  Has photo: ${analysis.loggedInUser.photoUrl ? 'YES' : 'NO'}`);

  console.log('\n=== PROFILE LINKS BY LOCATION ===');
  const inFeed = analysis.allProfileLinks.filter(p => p.isInFeed);
  const inSidebar = analysis.allProfileLinks.filter(p => p.isInSidebar);
  const inHeader = analysis.allProfileLinks.filter(p => p.isInHeader);
  const other = analysis.allProfileLinks.filter(p => !p.isInFeed && !p.isInSidebar && !p.isInHeader);

  console.log(`\nIn FEED (${inFeed.length}):`);
  for (const p of inFeed.slice(0, 15)) {
    const isLoggedIn = p.userId === analysis.loggedInUser.id ? ' ⚠️ LOGGED-IN USER!' : '';
    console.log(`  Y=${p.y} "${p.name}" (ID: ${p.userId})${isLoggedIn}`);
  }

  console.log(`\nIn SIDEBAR (${inSidebar.length}):`);
  for (const p of inSidebar.slice(0, 5)) {
    console.log(`  "${p.name}" (ID: ${p.userId})`);
  }

  console.log(`\nIn HEADER (${inHeader.length}):`);
  for (const p of inHeader.slice(0, 5)) {
    console.log(`  "${p.name}" (ID: ${p.userId})`);
  }

  console.log(`\nOTHER (${other.length}):`);
  for (const p of other.slice(0, 5)) {
    console.log(`  Y=${p.y} "${p.name}" (ID: ${p.userId})`);
  }

  console.log('\n=== TEXT ELEMENTS WITH NEARBY PROFILES ===');
  for (const item of analysis.textElementsWithNearbyProfiles) {
    console.log(`\nText (Y=${item.textY}): "${item.textPreview}..."`);
    if (item.nearbyProfiles.length === 0) {
      console.log('  NO PROFILES FOUND IN FEED!');
    } else {
      for (const p of item.nearbyProfiles) {
        const isLoggedIn = p.userId === analysis.loggedInUser.id ? ' ⚠️ LOGGED-IN USER!' : '';
        console.log(`  ${p.direction} dist=${p.distance}px: "${p.name}" (ID: ${p.userId})${isLoggedIn}`);
      }
    }
  }

  // Save analysis
  await fs.writeFile(
    path.join(DEBUG_OUTPUT_DIR, 'author-debug.json'),
    JSON.stringify(analysis, null, 2)
  );

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
