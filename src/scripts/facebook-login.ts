/**
 * Facebook Login Script - Robust Session Creator
 *
 * This script opens a browser and waits for you to complete the Facebook login.
 * It automatically detects when you're logged in and saves the cookies.
 *
 * Usage: npx ts-node src/scripts/facebook-login.ts
 */

import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const COOKIES_PATH = path.join(__dirname, '../config/cookies.json');
const GROUP_ID = process.env.GROUP_IDS?.split(',')[0] || '136596023614231';
const GROUP_URL = `https://www.facebook.com/groups/${GROUP_ID}`;

interface SessionStatus {
  hasSession: boolean;
  userId: string | null;
  cookieCount: number;
}

/**
 * Check if the current cookies indicate a valid logged-in session
 */
async function checkSessionStatus(context: BrowserContext): Promise<SessionStatus> {
  const cookies = await context.cookies();
  const cUser = cookies.find((c) => c.name === 'c_user' && c.domain.includes('facebook.com'));
  const xs = cookies.find((c) => c.name === 'xs' && c.domain.includes('facebook.com'));

  return {
    hasSession: Boolean(cUser && xs),
    userId: cUser?.value || null,
    cookieCount: cookies.length,
  };
}

/**
 * Save cookies to file
 */
async function saveCookies(context: BrowserContext): Promise<number> {
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  return cookies.length;
}

/**
 * Wait for login by polling for the c_user cookie
 */
async function waitForLogin(page: Page, context: BrowserContext, timeoutMs = 300000): Promise<SessionStatus> {
  const startTime = Date.now();
  let lastStatus: SessionStatus = { hasSession: false, userId: null, cookieCount: 0 };

  console.log('\n⏳ Waiting for login (auto-detects when you complete login)...\n');

  while (Date.now() - startTime < timeoutMs) {
    // Check cookies
    lastStatus = await checkSessionStatus(context);

    if (lastStatus.hasSession) {
      return lastStatus;
    }

    // Also check if we're on the Facebook home page (indicates successful login)
    const url = page.url();
    if (url.includes('facebook.com') && !url.includes('/login') && !url.includes('/checkpoint')) {
      // Double-check cookies after a small delay
      await page.waitForTimeout(2000);
      lastStatus = await checkSessionStatus(context);
      if (lastStatus.hasSession) {
        return lastStatus;
      }
    }

    // Wait before next check
    await page.waitForTimeout(1000);
  }

  return lastStatus;
}

/**
 * Check if the page shows the group feed (confirms we have access)
 */
async function verifyGroupAccess(page: Page): Promise<boolean> {
  try {
    // Look for feed or article elements
    const hasFeed = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      const articles = document.querySelectorAll('div[role="article"]');
      return Boolean(feed || articles.length > 0);
    });
    return hasFeed;
  } catch {
    return false;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Facebook Session Creator - Tarasa Extractor          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('📋 This script will:');
  console.log('   1. Open a browser at the Facebook group');
  console.log('   2. Wait for you to login (if needed)');
  console.log('   3. Automatically detect when login is complete');
  console.log('   4. Save cookies for the scraper to use\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  // Check if we already have valid cookies
  const existingCookies = fs.existsSync(COOKIES_PATH) ? JSON.parse(fs.readFileSync(COOKIES_PATH, 'utf-8')) : [];
  if (existingCookies.length > 0) {
    await context.addCookies(existingCookies);
    console.log(`📦 Loaded ${existingCookies.length} existing cookies`);
  }

  // Navigate to the group
  console.log(`\n🌐 Opening: ${GROUP_URL}`);
  await page.goto(GROUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Check initial session status
  let status = await checkSessionStatus(context);

  if (status.hasSession) {
    console.log(`\n✅ Already logged in! User ID: ${status.userId}`);
  } else {
    console.log('\n🔐 Please login to Facebook in the browser window...');
    console.log('   (This script will automatically detect when you complete login)\n');

    // Wait for login
    status = await waitForLogin(page, context);

    if (!status.hasSession) {
      console.log('\n❌ Login timeout. Please try again.');
      await browser.close();
      process.exit(1);
    }

    console.log(`\n✅ Login detected! User ID: ${status.userId}`);
  }

  // Navigate to group to verify access
  console.log(`\n🔄 Verifying group access...`);
  const currentUrl = page.url();
  if (!currentUrl.includes(GROUP_ID)) {
    await page.goto(GROUP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  // Wait for content to load
  await page.waitForTimeout(3000);

  // Check if we can see the group
  const hasAccess = await verifyGroupAccess(page);
  if (hasAccess) {
    console.log('✅ Group feed detected - you have access!');
  } else {
    console.log('⚠️  Could not detect group feed (may need to scroll or wait)');
    console.log('   Cookies will still be saved - scraper may work.');
  }

  // Save cookies
  const savedCount = await saveCookies(context);
  console.log(`\n💾 Saved ${savedCount} cookies to: ${COOKIES_PATH}`);

  // Final status
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      SESSION CREATED                         ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  User ID:     ${status.userId?.padEnd(45) || 'Unknown'.padEnd(45)} ║`);
  console.log(`║  Cookies:     ${String(savedCount).padEnd(45)} ║`);
  console.log(`║  Group:       ${GROUP_ID.padEnd(45)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n🎉 You can now run the scraper! The session will be used automatically.\n');

  await browser.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
