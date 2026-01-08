/**
 * Facebook Login Script - Robust Session Creator with Persistent Profile
 *
 * This script opens a browser with a persistent profile and waits for you
 * to complete the Facebook login. The session persists across restarts.
 *
 * Usage: npm run fb:login
 */

import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  markSessionValid,
  markSessionInvalid,
  saveSessionHealth,
  loadSessionHealth,
} from '../session/sessionHealth';
import prisma from '../database/prisma';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const COOKIES_PATH = path.join(__dirname, '../config/cookies.json');
const GROUP_ID = process.env.GROUP_IDS?.split(',')[0] || '136596023614231';
const GROUP_URL = `https://www.facebook.com/groups/${GROUP_ID}`;

interface SessionStatus {
  hasSession: boolean;
  userId: string | null;
  userName: string | null;
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
    userName: null, // Will be extracted from page
    cookieCount: cookies.length,
  };
}

/**
 * Extract user name from page if logged in
 */
async function extractUserName(page: Page): Promise<string | null> {
  try {
    // Try to find the profile link or account menu
    const name = await page.evaluate(() => {
      // Try aria-label on profile links
      const profileLink = document.querySelector('[aria-label="Your profile"]');
      if (profileLink) {
        const label = profileLink.getAttribute('aria-label');
        if (label && label !== 'Your profile') return label;
      }

      // Try to find name in account area
      const accountElements = document.querySelectorAll('[data-pagelet="ProfileActions"] span');
      for (const el of accountElements) {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 50 && !text.includes('Log')) {
          return text;
        }
      }

      return null;
    });
    return name;
  } catch {
    return null;
  }
}

/**
 * Save cookies to legacy file (for backward compatibility)
 */
async function saveLegacyCookies(context: BrowserContext): Promise<number> {
  const cookies = await context.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  return cookies.length;
}

/**
 * Wait for login by polling for the c_user cookie
 */
async function waitForLogin(page: Page, context: BrowserContext, timeoutMs = 300000): Promise<SessionStatus> {
  const startTime = Date.now();
  let lastStatus: SessionStatus = { hasSession: false, userId: null, userName: null, cookieCount: 0 };

  console.log('\n⏳ Waiting for login (auto-detects when you complete login)...\n');

  while (Date.now() - startTime < timeoutMs) {
    // Check cookies
    lastStatus = await checkSessionStatus(context);

    if (lastStatus.hasSession) {
      // Try to extract username
      lastStatus.userName = await extractUserName(page);
      return lastStatus;
    }

    // Also check if we're on the Facebook home page (indicates successful login)
    const url = page.url();
    if (url.includes('facebook.com') && !url.includes('/login') && !url.includes('/checkpoint')) {
      // Double-check cookies after a small delay
      await page.waitForTimeout(2000);
      lastStatus = await checkSessionStatus(context);
      if (lastStatus.hasSession) {
        lastStatus.userName = await extractUserName(page);
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

/**
 * Update session state in database
 */
async function updateSessionInDb(userId: string, userName: string | null): Promise<void> {
  try {
    const existing = await prisma.sessionState.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await prisma.sessionState.update({
        where: { id: existing.id },
        data: {
          status: 'valid',
          lastChecked: new Date(),
          lastValid: new Date(),
          userId,
          userName,
          errorMessage: null,
        },
      });
    } else {
      await prisma.sessionState.create({
        data: {
          status: 'valid',
          lastChecked: new Date(),
          lastValid: new Date(),
          userId,
          userName,
          errorMessage: null,
        },
      });
    }
  } catch (error) {
    console.log(`⚠️  Could not update database: ${(error as Error).message}`);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║    Facebook Session Creator - Persistent Profile Edition     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('📋 This script will:');
  console.log('   1. Open a browser with PERSISTENT profile (session saves automatically)');
  console.log('   2. Wait for you to login (if needed)');
  console.log('   3. Automatically detect when login is complete');
  console.log('   4. Update session health status');
  console.log('   5. Save cookies for backward compatibility\n');

  console.log(`📁 Browser profile: ${BROWSER_DATA_DIR}\n`);

  // Ensure browser data directory exists
  if (!fs.existsSync(BROWSER_DATA_DIR)) {
    fs.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
  }

  // Launch with persistent context
  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const page = await context.newPage();

  // Navigate to the group
  console.log(`🌐 Opening: ${GROUP_URL}`);
  await page.goto(GROUP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait a moment for page to settle
  await page.waitForTimeout(3000);

  // Check initial session status
  let status = await checkSessionStatus(context);
  status.userName = await extractUserName(page);

  if (status.hasSession) {
    console.log(`\n✅ Already logged in!`);
    console.log(`   User ID: ${status.userId}`);
    if (status.userName) {
      console.log(`   Name: ${status.userName}`);
    }
  } else {
    console.log('\n🔐 Please login to Facebook in the browser window...');
    console.log('   (This script will automatically detect when you complete login)\n');

    // Wait for login
    status = await waitForLogin(page, context);

    if (!status.hasSession) {
      console.log('\n❌ Login timeout. Please try again.');
      await markSessionInvalid('Login timeout');
      await context.close();
      process.exit(1);
    }

    console.log(`\n✅ Login detected!`);
    console.log(`   User ID: ${status.userId}`);
    if (status.userName) {
      console.log(`   Name: ${status.userName}`);
    }
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
    console.log('   Session will still be saved - scraper may work.');
  }

  // Update session health
  console.log('\n💾 Updating session health...');
  await markSessionValid(status.userId!, status.userName || undefined);
  await updateSessionInDb(status.userId!, status.userName);

  // Save legacy cookies for backward compatibility
  const savedCount = await saveLegacyCookies(context);
  console.log(`💾 Saved ${savedCount} cookies to: ${COOKIES_PATH}`);

  // Final status
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                 SESSION CREATED SUCCESSFULLY                 ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  User ID:     ${(status.userId || 'Unknown').padEnd(45)} ║`);
  console.log(`║  User Name:   ${(status.userName || 'Unknown').padEnd(45)} ║`);
  console.log(`║  Cookies:     ${String(savedCount).padEnd(45)} ║`);
  console.log(`║  Group:       ${GROUP_ID.padEnd(45)} ║`);
  console.log(`║  Profile:     Persistent (browser-data/)${' '.repeat(19)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n🎉 Session will persist across restarts!');
  console.log('   You can now run the scraper - it will use this session automatically.\n');

  await context.close();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('\n❌ Error:', error.message);
  await markSessionInvalid(error.message);
  await prisma.$disconnect();
  process.exit(1);
});
