/**
 * Facebook Auto Login Script
 *
 * Automatically logs in to Facebook using credentials from .env file.
 * This runs when the session expires and needs to be refreshed.
 *
 * Usage: npx ts-node src/scripts/facebook-auto-login.ts
 *
 * Required .env variables:
 *   FB_EMAIL=your-email@example.com
 *   FB_PASSWORD=your-password
 */

import 'dotenv/config';
import { chromium, BrowserContext, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import {
  markSessionValid,
  markSessionInvalid,
} from '../session/sessionHealth';
import prisma from '../database/prisma';
import logger from '../utils/logger';

const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
const COOKIES_PATH = path.join(__dirname, '../config/cookies.json');
const LOGIN_URL = 'https://www.facebook.com/login';

// Get credentials from environment
const FB_EMAIL = process.env.FB_EMAIL;
const FB_PASSWORD = process.env.FB_PASSWORD;

/**
 * Human-like delay to avoid detection
 */
const humanDelay = (min = 500, max = 1500): Promise<void> => {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, delay));
};

/**
 * Type text like a human (character by character with random delays)
 */
async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.click(selector);
  await humanDelay(200, 400);

  for (const char of text) {
    await page.keyboard.type(char, { delay: Math.random() * 100 + 50 });
  }
}

/**
 * Check if logged in by looking for session cookies
 */
async function isLoggedIn(context: BrowserContext): Promise<{ loggedIn: boolean; userId: string | null }> {
  // Get all cookies
  let cookies = await context.cookies();

  // Also try to get cookies specifically from Facebook URLs
  const fbUrls = ['https://www.facebook.com', 'https://facebook.com', 'https://m.facebook.com'];
  for (const url of fbUrls) {
    try {
      const domainCookies = await context.cookies(url);
      for (const cookie of domainCookies) {
        if (!cookies.find((c) => c.name === cookie.name && c.domain === cookie.domain)) {
          cookies.push(cookie);
        }
      }
    } catch {
      // Ignore errors
    }
  }

  // Check for c_user and xs cookies with flexible domain matching
  const cUser = cookies.find((c) =>
    c.name === 'c_user' &&
    (c.domain.includes('facebook') || c.domain === '.facebook.com' || c.domain === 'facebook.com')
  );
  const xs = cookies.find((c) =>
    c.name === 'xs' &&
    (c.domain.includes('facebook') || c.domain === '.facebook.com' || c.domain === 'facebook.com')
  );

  logger.debug(`Cookie check: total=${cookies.length}, c_user=${!!cUser}, xs=${!!xs}`);
  if (cUser) {
    logger.debug(`c_user domain: ${cUser.domain}`);
  }

  return {
    loggedIn: Boolean(cUser && xs),
    userId: cUser?.value || null,
  };
}

/**
 * Handle 2FA if it appears
 */
async function handle2FA(page: Page): Promise<boolean> {
  try {
    // Check if 2FA prompt appears
    const has2FA = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      return (
        text.includes('two-factor') ||
        text.includes('authentication code') ||
        text.includes('enter the code') ||
        text.includes('security code') ||
        text.includes('login code')
      );
    });

    if (has2FA) {
      console.log('\n⚠️  Two-Factor Authentication detected!');
      console.log('   Please enter your 2FA code in the browser window...');
      console.log('   Waiting up to 2 minutes for 2FA completion...\n');

      // Wait for 2FA to complete (user enters code)
      const startTime = Date.now();
      const timeout = 120000; // 2 minutes

      while (Date.now() - startTime < timeout) {
        await page.waitForTimeout(2000);

        // Check if we're past 2FA
        const stillOn2FA = await page.evaluate(() => {
          const text = document.body.innerText.toLowerCase();
          return (
            text.includes('two-factor') ||
            text.includes('authentication code') ||
            text.includes('enter the code')
          );
        });

        if (!stillOn2FA) {
          console.log('   2FA completed!');
          return true;
        }
      }

      console.log('   2FA timeout - please try manual login');
      return false;
    }

    return true; // No 2FA needed
  } catch {
    return true; // Continue if check fails
  }
}

/**
 * Handle "Remember browser" or similar prompts
 */
async function handlePostLoginPrompts(page: Page): Promise<void> {
  try {
    await humanDelay(1000, 2000);

    // Look for "Not Now" or "Skip" buttons on various prompts
    const skipSelectors = [
      'button:has-text("Not Now")',
      'button:has-text("Skip")',
      'a:has-text("Not Now")',
      '[aria-label="Not Now"]',
      '[aria-label="Close"]',
      'div[role="button"]:has-text("Not Now")',
    ];

    for (const selector of skipSelectors) {
      try {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          await humanDelay(500, 1000);
        }
      } catch {
        // Continue to next selector
      }
    }
  } catch {
    // Ignore prompt handling errors
  }
}

/**
 * Save cookies for persistence
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
async function updateSessionInDb(userId: string): Promise<void> {
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
          errorMessage: null,
        },
      });
    }
  } catch (error) {
    logger.warn(`Could not update database: ${(error as Error).message}`);
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

/**
 * Main auto-login function
 */
export async function autoLogin(): Promise<{ success: boolean; userId?: string; error?: string }> {
  // Validate credentials
  if (!FB_EMAIL || !FB_PASSWORD) {
    const error = 'FB_EMAIL and FB_PASSWORD must be set in .env file';
    logger.error(error);
    return { success: false, error };
  }

  logger.info('Starting automatic Facebook login...');

  // Ensure directories exist
  if (!fs.existsSync(BROWSER_DATA_DIR)) {
    fs.mkdirSync(BROWSER_DATA_DIR, { recursive: true });
  }

  cleanupLockFiles();

  let context: BrowserContext | null = null;

  try {
    // Launch browser with persistent context
    context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
      headless: false, // Must be visible for login
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
      ],
      timeout: 60000,
    });

    const page = await context.newPage();

    // Check if already logged in
    await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(2000, 3000);

    let loginStatus = await isLoggedIn(context);

    if (loginStatus.loggedIn) {
      logger.info(`Already logged in as user ${loginStatus.userId}`);
      await markSessionValid(loginStatus.userId!);
      await updateSessionInDb(loginStatus.userId!);
      await saveCookies(context);
      await context.close();
      return { success: true, userId: loginStatus.userId! };
    }

    // Navigate to login page
    logger.info('Navigating to Facebook login page...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await humanDelay(1000, 2000);

    // Fill in email
    logger.info('Entering email...');
    const emailSelector = '#email, input[name="email"], input[type="email"]';
    await page.waitForSelector(emailSelector, { timeout: 10000 });
    await humanType(page, emailSelector, FB_EMAIL);
    await humanDelay(300, 600);

    // Fill in password
    logger.info('Entering password...');
    const passwordSelector = '#pass, input[name="pass"], input[type="password"]';
    await page.waitForSelector(passwordSelector, { timeout: 10000 });
    await humanType(page, passwordSelector, FB_PASSWORD);
    await humanDelay(500, 1000);

    // Click login button
    logger.info('Clicking login button...');
    const loginButtonSelector = 'button[name="login"], button[type="submit"], #loginbutton, button:has-text("Log In")';
    await page.click(loginButtonSelector);

    // Wait for navigation
    await humanDelay(3000, 5000);

    // Handle 2FA if needed
    const passed2FA = await handle2FA(page);
    if (!passed2FA) {
      await markSessionInvalid('2FA timeout');
      await context.close();
      return { success: false, error: '2FA verification required but timed out' };
    }

    // Handle post-login prompts
    await handlePostLoginPrompts(page);

    // Wait longer for login to complete
    await humanDelay(3000, 5000);

    // Check for various login outcomes
    const currentUrl = page.url();
    logger.info(`Current URL after login: ${currentUrl}`);

    // Check for 2FA or checkpoint/verification
    if (currentUrl.includes('two_step_verification') || currentUrl.includes('checkpoint')) {
      logger.warn('Facebook checkpoint detected - verification required');

      // Check what type of verification
      const checkpointType = await page.evaluate(() => {
        const url = window.location.href;
        const text = document.body.innerText.toLowerCase();

        // Check URL first
        if (url.includes('two_step_verification')) return '2fa';

        // Then check page content
        if (text.includes('enter the code') || text.includes('authentication code') || text.includes('security code')) return '2fa';
        if (text.includes('confirm your identity')) return 'identity';
        if (text.includes('suspicious')) return 'suspicious';
        if (text.includes('photo')) return 'photo_verify';
        return 'unknown';
      });

      logger.warn(`Checkpoint type: ${checkpointType}`);

      // For 2FA, wait for user input
      if (checkpointType === '2fa') {
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║           TWO-FACTOR AUTHENTICATION REQUIRED                 ║');
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log('║  A browser window should be open with Facebook.              ║');
        console.log('║  Please enter your 2FA code from your authenticator app.     ║');
        console.log('║                                                              ║');
        console.log('║  Waiting up to 2 minutes for you to complete 2FA...          ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');

        // Wait up to 2 minutes, checking every 5 seconds
        const maxWait = 120000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          await page.waitForTimeout(5000);
          loginStatus = await isLoggedIn(context);

          if (loginStatus.loggedIn) {
            console.log('   2FA completed successfully!');
            break;
          }

          // Check if still on 2FA page
          const stillOn2FA = page.url().includes('two_step_verification') || page.url().includes('checkpoint');
          if (!stillOn2FA) {
            loginStatus = await isLoggedIn(context);
            break;
          }

          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`   Waiting... (${elapsed}s / 120s)`);
        }
      } else {
        // Keep browser open for manual intervention
        console.log('\n╔══════════════════════════════════════════════════════════════╗');
        console.log('║           FACEBOOK VERIFICATION REQUIRED                     ║');
        console.log('╠══════════════════════════════════════════════════════════════╣');
        console.log(`║  Type: ${checkpointType.padEnd(52)} ║`);
        console.log('║  Please complete verification in the browser window.         ║');
        console.log('║  Waiting up to 2 minutes...                                  ║');
        console.log('╚══════════════════════════════════════════════════════════════╝\n');

        const maxWait = 120000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxWait) {
          await page.waitForTimeout(5000);
          loginStatus = await isLoggedIn(context);

          if (loginStatus.loggedIn) {
            console.log('   Verification completed successfully!');
            break;
          }

          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`   Waiting... (${elapsed}s / 120s)`);
        }
      }
    } else {
      loginStatus = await isLoggedIn(context);
    }

    if (loginStatus.loggedIn) {
      logger.info(`Login successful! User ID: ${loginStatus.userId}`);

      // Save session
      await markSessionValid(loginStatus.userId!);
      await updateSessionInDb(loginStatus.userId!);
      const cookieCount = await saveCookies(context);

      logger.info(`Saved ${cookieCount} cookies`);

      await context.close();
      return { success: true, userId: loginStatus.userId! };
    } else {
      // Check for error messages
      const errorInfo = await page.evaluate(() => {
        // Check for specific error elements
        const errorEl = document.querySelector('[role="alert"], .login_error_box, ._9ay7, [data-testid="royal_login_error"]');
        const errorText = errorEl?.textContent?.trim();

        // Check page content for clues
        const bodyText = document.body.innerText.toLowerCase();
        let hint = '';
        if (bodyText.includes('incorrect password')) hint = 'incorrect_password';
        else if (bodyText.includes('email') && bodyText.includes('not')) hint = 'email_not_found';
        else if (bodyText.includes('try again')) hint = 'try_again';
        else if (bodyText.includes('suspicious')) hint = 'suspicious_activity';
        else if (bodyText.includes('disabled')) hint = 'account_disabled';

        return {
          error: errorText || null,
          hint,
          url: window.location.href,
        };
      });

      const errorMessage = errorInfo.error || errorInfo.hint || 'Login failed - check browser for details';
      logger.error(`Login failed: ${errorMessage}`);
      logger.info(`Page URL: ${errorInfo.url}`);

      // Take screenshot for debugging
      const screenshotPath = path.join(process.cwd(), 'login-error.png');
      await page.screenshot({ path: screenshotPath });
      logger.info(`Screenshot saved to: ${screenshotPath}`);

      await markSessionInvalid(errorMessage);
      await context.close();
      return { success: false, error: errorMessage };
    }
  } catch (error) {
    const errorMsg = (error as Error).message;
    logger.error(`Auto-login error: ${errorMsg}`);
    await markSessionInvalid(errorMsg);

    if (context) {
      try {
        await context.close();
      } catch {
        // Ignore close errors
      }
    }

    return { success: false, error: errorMsg };
  }
}

// Run if called directly
if (require.main === module) {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         Facebook Auto Login - Automatic Session Creator       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  autoLogin()
    .then(async (result) => {
      if (result.success) {
        console.log('\n✅ Auto-login successful!');
        console.log(`   User ID: ${result.userId}`);
        console.log('\n   Session is now valid. You can run the scraper.\n');
      } else {
        console.log('\n❌ Auto-login failed!');
        console.log(`   Error: ${result.error}`);
        console.log('\n   Please try manual login: npx ts-node src/scripts/facebook-login.ts\n');
      }
      await prisma.$disconnect();
      process.exit(result.success ? 0 : 1);
    })
    .catch(async (error) => {
      console.error('\n❌ Fatal error:', error.message);
      await prisma.$disconnect();
      process.exit(1);
    });
}
