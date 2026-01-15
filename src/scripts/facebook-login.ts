/**
 * Facebook Login Script - Simple Manual Login
 *
 * Opens a browser window for you to log in to Facebook manually.
 * The script waits and detects when you've successfully logged in.
 *
 * IMPORTANT: This script NEVER refreshes or navigates the page while you're logging in.
 * It only checks cookies in the background.
 *
 * Usage: npm run fb:login
 */

import { chromium, BrowserContext } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { markSessionValid, markSessionInvalid } from '../session/sessionHealth';
import prisma from '../database/prisma';
import { SessionStatus } from '@prisma/client';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const COOKIES_PATH = path.join(__dirname, '../config/cookies.json');

/**
 * Check for Facebook session cookies
 * This only reads cookies from memory - does NOT touch the page
 */
async function getSessionCookies(context: BrowserContext, debug = false): Promise<{ userId: string | null; hasSession: boolean }> {
  try {
    // Get ALL cookies from the context
    const allCookies = await context.cookies();

    if (debug) {
      console.log(`\n[DEBUG] Total cookies in browser: ${allCookies.length}`);
      console.log('[DEBUG] ALL cookies:');
      allCookies.forEach(c => {
        console.log(`  - ${c.name}: ${c.value.substring(0, 30)}... (domain: ${c.domain}, httpOnly: ${c.httpOnly})`);
      });
    }

    // Find the essential cookies (search in ALL cookies)
    const cUser = allCookies.find((c) => c.name === 'c_user');
    const xs = allCookies.find((c) => c.name === 'xs');

    // Also look for alternative session indicators
    const userId = cUser?.value || null;
    const hasSession = Boolean(cUser?.value && xs?.value);

    if (debug) {
      console.log(`\n[DEBUG] c_user: ${cUser ? `FOUND (${cUser.value})` : 'NOT FOUND'}`);
      console.log(`[DEBUG] xs: ${xs ? 'FOUND' : 'NOT FOUND'}`);
    }

    return {
      userId,
      hasSession,
    };
  } catch (e) {
    console.log(`[DEBUG] Error getting cookies: ${e}`);
    return { userId: null, hasSession: false };
  }
}

/**
 * Save all cookies to file
 */
async function saveCookies(context: BrowserContext): Promise<number> {
  const cookies = await context.cookies();

  // Ensure config directory exists
  const configDir = path.dirname(COOKIES_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  return cookies.length;
}

/**
 * Update session in database
 */
async function saveToDatabase(userId: string): Promise<void> {
  try {
    const existing = await prisma.sessionState.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const data = {
      status: SessionStatus.valid,
      lastChecked: new Date(),
      lastValid: new Date(),
      userId,
      errorMessage: null,
    };

    if (existing) {
      await prisma.sessionState.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.sessionState.create({ data });
    }
  } catch (error) {
    console.log(`   Warning: Could not save to database: ${(error as Error).message}`);
  }
}

/**
 * Clean up browser lock files
 */
function cleanupLockFiles(): void {
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const lockFile of lockFiles) {
    const lockPath = path.join(BROWSER_DATA_DIR, lockFile);
    try {
      if (fs.existsSync(lockPath)) {
        fs.unlinkSync(lockPath);
      }
    } catch {
      // Ignore
    }
  }
}

async function main() {
  console.log('\n========================================');
  console.log('   Facebook Login - Manual Session');
  console.log('========================================\n');

  console.log('Instructions:');
  console.log('  1. A browser window will open');
  console.log('  2. Log in to Facebook manually');
  console.log('  3. Complete any CAPTCHA or 2FA if needed');
  console.log('  4. The script detects login automatically');
  console.log('  5. DO NOT close the browser until you see "LOGIN SUCCESSFUL"\n');

  // Setup
  if (!fs.existsSync(BROWSER_DATA_DIR)) {
    fs.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
  }
  cleanupLockFiles();

  // Check for existing storage state
  const storagePath = path.join(BROWSER_DATA_DIR, 'storage-state.json');
  const hasStorageState = fs.existsSync(storagePath);

  // Launch using real Chrome browser (not Playwright's Chromium)
  console.log('Opening Chrome browser...\n');
  console.log('NOTE: Using real Chrome to avoid Facebook bot detection.\n');

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    channel: 'chrome', // Use real Chrome instead of Playwright Chromium
    headless: false,
    viewport: null, // Use default viewport
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features=IdleDetection'],
  });

  // If we have saved storage state, load it
  if (hasStorageState) {
    try {
      const storageState = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
      if (storageState.cookies && storageState.cookies.length > 0) {
        await context.addCookies(storageState.cookies);
        console.log(`Loaded ${storageState.cookies.length} saved cookies.\n`);
      }
    } catch (e) {
      console.log('Could not load saved state, starting fresh.\n');
    }
  }

  const page = await context.newPage();

  // Go to Facebook ONCE - then never navigate again until login is detected
  console.log('Navigating to Facebook...\n');
  await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Check if already logged in
  let session = await getSessionCookies(context);

  if (session.hasSession) {
    console.log('Already logged in!');
    console.log(`User ID: ${session.userId}\n`);
  } else {
    console.log('Waiting for you to log in...');
    console.log('(The script checks cookies every 3 seconds - page will NOT refresh)\n');

    // Wait for login - check cookies every 3 seconds for 10 minutes
    const maxWait = 600000; // 10 minutes
    const startTime = Date.now();

    let checkCount = 0;
    let lastUrl = page.url();

    while (Date.now() - startTime < maxWait) {
      // Wait 3 seconds
      await new Promise(resolve => setTimeout(resolve, 3000));
      checkCount++;

      // Check current URL
      const currentUrl = page.url();
      if (currentUrl !== lastUrl) {
        console.log(`Page changed: ${currentUrl.substring(0, 60)}...`);
        lastUrl = currentUrl;
      }

      // Check for session cookies - enable debug every 10 checks (30 seconds)
      const enableDebug = checkCount % 10 === 0;
      session = await getSessionCookies(context, enableDebug);

      if (session.hasSession) {
        console.log('\n*** Login detected via cookies! ***\n');
        break;
      }

      // Alternative detection: Check if we might be logged in (on Facebook, not on login/checkpoint pages)
      const mightBeLoggedIn = currentUrl.includes('facebook.com') &&
        !currentUrl.includes('/login') &&
        !currentUrl.includes('/checkpoint') &&
        !currentUrl.includes('/recover') &&
        !currentUrl.includes('two_step');

      if (mightBeLoggedIn) {
        console.log('On Facebook homepage - checking if logged in via page content...');

        // Wait a moment for page to fully load
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Try to detect login via page content
        try {
          // Check if we can find user ID in page source
          const pageContent = await page.content();

          // Look for various user ID patterns (exclude "0" which is placeholder)
          const userIdMatch = pageContent.match(/"USER_ID":"(\d{5,})"/); // At least 5 digits
          const actorIdMatch = pageContent.match(/"actorID":"(\d{5,})"/);
          const viewerIdMatch = pageContent.match(/"viewer_id":"(\d{5,})"/);
          const profileIdMatch = pageContent.match(/fb:\/\/profile\/(\d{5,})/);

          const foundUserId = userIdMatch?.[1] || actorIdMatch?.[1] || viewerIdMatch?.[1] || profileIdMatch?.[1];

          if (foundUserId && foundUserId !== '0') {
            console.log(`\n*** Login detected via page content! User ID: ${foundUserId} ***\n`);
            session = { userId: foundUserId, hasSession: true };
            break;
          }

          // Check for login form - if it exists, we're NOT logged in
          const hasLoginForm = await page.$('input[name="email"]');
          if (!hasLoginForm) {
            // No login form and we're on facebook.com - might be logged in
            // Check for profile/account menu
            const hasProfileMenu = await page.$('[aria-label="Your profile"]') ||
                                   await page.$('[aria-label="Account"]') ||
                                   await page.$('[data-pagelet="ProfileActions"]');
            if (hasProfileMenu) {
              console.log('\n*** Login detected via profile menu! ***\n');
              // Try to extract user ID from profile link
              const profileLink = await page.$('[aria-label="Your profile"] a');
              if (profileLink) {
                const href = await profileLink.getAttribute('href');
                const idMatch = href?.match(/\/profile\.php\?id=(\d+)/) || href?.match(/facebook\.com\/(\d+)/);
                if (idMatch) {
                  session = { userId: idMatch[1], hasSession: true };
                  break;
                }
              }
              session = { userId: 'unknown', hasSession: true };
              break;
            }
          }
        } catch (e) {
          console.log(`Page content check error: ${e}`);
        }

        session = await getSessionCookies(context, true);
        if (session.hasSession) {
          console.log('\n*** Login detected after redirect! ***\n');
          break;
        }
      }

      // Show progress every 30 seconds
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      if (elapsed % 30 === 0 && elapsed > 0) {
        console.log(`Still waiting... (${elapsed}s) - Complete your login in the browser`);
      }
    }
  }

  // Check final status
  if (!session.hasSession) {
    console.log('\nLogin timed out or was not completed.');
    console.log('Please try again.\n');
    await markSessionInvalid('Login not completed');
    await context.close();
    await prisma.$disconnect();
    process.exit(1);
  }

  // Success - save everything
  console.log('Saving session...');

  // Save session health and database
  await markSessionValid(session.userId!);
  await saveToDatabase(session.userId!);

  // Save cookies to file
  const cookieCount = await saveCookies(context);

  // IMPORTANT: Save browser storage state to ensure cookies persist
  await context.storageState({ path: storagePath });
  console.log('Browser state saved to disk.');

  console.log('\n========================================');
  console.log('   LOGIN SUCCESSFUL!');
  console.log('========================================');
  console.log(`User ID: ${session.userId}`);
  console.log(`Cookies saved: ${cookieCount}`);
  console.log('========================================\n');

  console.log('Session saved! Browser will close in 5 seconds...\n');

  // Wait longer to ensure all data is flushed to disk
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Close gracefully
  await context.close();
  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('\nError:', error.message);
  await markSessionInvalid(error.message);
  await prisma.$disconnect();
  process.exit(1);
});
