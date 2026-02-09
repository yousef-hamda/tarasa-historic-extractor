import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import {
  selectors,
  findFirstHandle,
  fillFirstMatchingSelector,
  clickFirstMatchingSelector,
} from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import { sendAlertEmail } from '../utils/alerts';
import { logSystemEvent } from '../utils/systemLog';
import { TIMEOUTS } from '../config/constants';
import {
  createPersistentBrowser,
  checkAndUpdateSession,
  getSessionStatus,
  isSessionValid,
} from '../session/sessionManager';
import { markSessionBlocked } from '../session/sessionHealth';

// Helper to replace deprecated page.waitForTimeout
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const cookiesPath = path.resolve(__dirname, '../config/cookies.json');

// Re-export session manager functions for backward compatibility
export { checkAndUpdateSession, getSessionStatus, isSessionValid };

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export const loadCookies = async (): Promise<Cookie[]> => {
  try {
    const raw = await fs.readFile(cookiesPath, 'utf-8');
    const cookies: Cookie[] = JSON.parse(raw);
    const now = Date.now() / 1000;

    const validCookies = cookies.filter((cookie) => !cookie.expires || cookie.expires > now);
    if (cookies.length !== validCookies.length) {
      logger.warn(`Pruned ${cookies.length - validCookies.length} expired cookies from saved session`);
    }
    return validCookies;
  } catch (error) {
    // File doesn't exist or is invalid - start with fresh session
    logger.debug(`No existing cookies found: ${(error as Error).message}`);
    return [];
  }
};

export const saveCookies = async (context: BrowserContext): Promise<void> => {
  try {
    const cookies = await context.cookies();
    if (cookies && cookies.length > 0) {
      await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
      logger.info(`Cookies saved (${cookies.length} cookies)`);
    } else {
      logger.warn('No cookies to save');
    }
  } catch (error) {
    // Don't throw - cookie saving is not critical
    logger.warn(`Failed to save cookies: ${(error as Error).message}`);
  }
};

/**
 * Check if we have a valid Facebook session
 * The c_user cookie is the key indicator of a logged-in session
 */
export const getCookieHealth = async () => {
  const cookies = await loadCookies();
  const now = Date.now() / 1000;

  // Filter valid (non-expired) cookies
  const valid = cookies.filter((cookie) => !cookie.expires || cookie.expires > now + 300);

  // Check for the critical session cookie (c_user indicates logged-in user)
  const sessionCookie = cookies.find(
    (c) => c.name === 'c_user' && c.domain.includes('facebook.com') && (!c.expires || c.expires > now)
  );

  // Also check for xs cookie (session token)
  const xsCookie = cookies.find(
    (c) => c.name === 'xs' && c.domain.includes('facebook.com') && (!c.expires || c.expires > now)
  );

  const hasValidSession = Boolean(sessionCookie && xsCookie);

  return {
    ok: hasValidSession,
    total: cookies.length,
    valid: valid.length,
    hasSession: hasValidSession,
    userId: sessionCookie?.value || null,
  };
};

const detectTwoFactor = async (page: Page) => {
  const hasInput = (await findFirstHandle(page, selectors.twoFactorInput)).handle;
  const hasText = selectors.twoFactorText
    ? (await findFirstHandle(page, selectors.twoFactorText)).handle
    : null;
  return Boolean(hasInput || hasText);
};

const detectCaptcha = async (page: Page) => {
  const captchaMatch = selectors.captchaText
    ? (await findFirstHandle(page, selectors.captchaText)).handle
    : null;
  return Boolean(captchaMatch);
};

const handleChallenge = async (type: '2fa' | 'captcha') => {
  const message =
    type === '2fa'
      ? 'Facebook triggered two-factor authentication. Manual approval required.'
      : 'Facebook presented a security captcha. Automation paused.';

  await logSystemEvent('auth', message);
  await sendAlertEmail('Tarasa Facebook session requires attention', message);
};

export const ensureLogin = async (context: BrowserContext): Promise<void> => {
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUTS.PAGE_DEFAULT);

  await page.goto('https://www.facebook.com', {
    waitUntil: 'domcontentloaded',
    timeout: TIMEOUTS.NAVIGATION,
  });
  
  // Wait for page to be interactive
  await sleep(3000);

  const loginNeeded =
    (await findFirstHandle(page, selectors.loginEmail)).handle ||
    (await findFirstHandle(page, selectors.loginText)).handle;

  if (loginNeeded) {
    await logSystemEvent('auth', 'Facebook session expired. Logging in.');
    await fillFirstMatchingSelector(page, selectors.loginEmail, process.env.FB_EMAIL || '');
    await fillFirstMatchingSelector(page, selectors.loginPassword, process.env.FB_PASSWORD || '');
    await clickFirstMatchingSelector(page, selectors.loginButton);
    await sleep(5000); // Wait for login
    await humanDelay();
  }

  if (await detectTwoFactor(page)) {
    await handleChallenge('2fa');
    throw new Error('Two-factor authentication required');
  }

  if (await detectCaptcha(page)) {
    await handleChallenge('captcha');
    throw new Error('Captcha encountered');
  }

  await saveCookies(context);
  await logSystemEvent('auth', 'Facebook session verified.');
  await page.close();
};

/**
 * Create a Facebook browser context
 * @param options.publicGroupMode - Skip cookie loading for public group scraping
 *                                  When true, uses unauthenticated access which
 *                                  renders post URLs correctly for public groups
 */
export const createFacebookContext = async (options?: { publicGroupMode?: boolean }): Promise<{ browser: Browser; context: BrowserContext }> => {
  const { publicGroupMode = false } = options || {};

  // NOTE: Persistent browser is disabled for scraping because it causes
  // Facebook to not render post URLs properly. Using fresh browser with cookies instead.
  // The persistent browser might have accumulated state that affects FB rendering.

  // OPTION: Force use of fresh browser by skipping persistent browser entirely
  const useFreshBrowser = true;  // Set to false to re-enable persistent browser

  if (!useFreshBrowser && !publicGroupMode) {
  // Try to use persistent browser first (preferred method)
  try {
    const { browser, context } = await createPersistentBrowser();

    // Verify session is valid
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.PAGE_DEFAULT);

    await page.goto('https://www.facebook.com', {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.NAVIGATION,
    });

    await sleep(3000);

    const loginNeeded =
      (await findFirstHandle(page, selectors.loginEmail)).handle ||
      (await findFirstHandle(page, selectors.loginText)).handle;

    if (loginNeeded) {
      logger.warn('Persistent browser session not logged in. Attempting login...');
      await fillFirstMatchingSelector(page, selectors.loginEmail, process.env.FB_EMAIL || '');
      await fillFirstMatchingSelector(page, selectors.loginPassword, process.env.FB_PASSWORD || '');
      await clickFirstMatchingSelector(page, selectors.loginButton);
      await sleep(5000);
      await humanDelay();
    }

    if (await detectTwoFactor(page)) {
      await handleChallenge('2fa');
      await markSessionBlocked('Two-factor authentication required');
      throw new Error('Two-factor authentication required');
    }

    if (await detectCaptcha(page)) {
      await handleChallenge('captcha');
      await markSessionBlocked('Security captcha required');
      throw new Error('Captcha encountered');
    }

    await page.close();
    await logSystemEvent('auth', 'Facebook session verified with persistent browser.');
    return { browser, context };
  } catch (persistentError) {
    logger.warn(`Persistent browser failed: ${(persistentError as Error).message}. Falling back to cookie-based approach.`);
  }
  } // End of if (!useFreshBrowser)

  // Fresh browser with cookie-based approach (used for scraping)
  // Default to headless unless explicitly set to false
  const headless = process.env.HEADLESS !== 'false';
  logger.info(`Fallback browser launching (headless: ${headless})`);
  const browser = await chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-software-rasterizer',
    ],
  });
  const context = await browser.newContext();

  // Cookie loading: Skip for public groups to ensure URLs render correctly
  if (publicGroupMode) {
    logger.info('Scraping without cookies (public group mode)');
    // Don't load cookies - public groups render URLs better without auth
  } else {
    // Load cookies for authenticated operations (messenger, private groups, etc.)
    const cookies = await loadCookies();
    if (cookies.length) {
      await context.addCookies(cookies);
      logger.info(`Loaded ${cookies.length} cookies into fresh browser context`);
    }

    // Verify login for authenticated operations
    try {
      await ensureLogin(context);
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  return { browser, context };
};

export const refreshFacebookSession = async (): Promise<{ success: boolean; error?: string }> => {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  try {
    const result = await createFacebookContext();
    browser = result.browser;
    context = result.context;

    // Verify we're actually logged in by checking for user elements
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUTS.PAGE_DEFAULT);

    await page.goto('https://www.facebook.com', {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.NAVIGATION,
    });

    await sleep(3000);

    // Check if we're on the login page (not logged in)
    const loginNeeded =
      (await findFirstHandle(page, selectors.loginEmail)).handle ||
      (await findFirstHandle(page, selectors.loginText)).handle;

    if (loginNeeded) {
      await page.close();
      logger.error('[Session] Refresh failed - still on login page after refresh attempt');
      await logSystemEvent('auth', 'Session refresh failed - login required');
      return { success: false, error: 'Login required - credentials may be incorrect' };
    }

    // Check for 2FA
    if (await detectTwoFactor(page)) {
      await page.close();
      await handleChallenge('2fa');
      await markSessionBlocked('Two-factor authentication required');
      return { success: false, error: 'Two-factor authentication required' };
    }

    // Check for captcha
    if (await detectCaptcha(page)) {
      await page.close();
      await handleChallenge('captcha');
      await markSessionBlocked('Security captcha required');
      return { success: false, error: 'Security captcha required' };
    }

    await page.close();
    await saveCookies(context);
    await logSystemEvent('auth', 'Facebook session refreshed successfully');
    return { success: true };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Session] Refresh failed: ${message}`);
    return { success: false, error: message };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
  }
};

/**
 * Interactive session renewal - Opens a VISIBLE browser for manual login
 * This is used by the dashboard "Renew Session" button
 * Returns a promise that resolves when the user logs in or times out
 */
export const interactiveSessionRenewal = async (
  timeoutMs: number = 300000 // 5 minutes default
): Promise<{ success: boolean; userId?: string; error?: string }> => {
  const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');
  const storagePath = path.join(BROWSER_DATA_DIR, 'storage-state.json');
  const cookiesPath = path.resolve(__dirname, '../config/cookies.json');

  // First, check if we already have a valid session without opening a browser
  const existingHealth = await checkSessionCookies_fromFile(cookiesPath);
  if (existingHealth.hasSession) {
    logger.info(`[Session] Session already valid for user ${existingHealth.userId} - no browser needed`);

    // Just update the database and session health
    const { markSessionValid } = await import('../session/sessionHealth');
    await markSessionValid(existingHealth.userId!);

    // Update database
    const prisma = (await import('../database/prisma')).default;
    try {
      const existing = await prisma.sessionState.findFirst({ orderBy: { createdAt: 'desc' } });
      const data = { status: 'valid' as const, lastChecked: new Date(), lastValid: new Date(), userId: existingHealth.userId, errorMessage: null };
      if (existing) {
        await prisma.sessionState.update({ where: { id: existing.id }, data });
      } else {
        await prisma.sessionState.create({ data });
      }
    } catch (e) {
      logger.warn(`[Session] DB update error: ${(e as Error).message}`);
    }

    await logSystemEvent('auth', `Session validated for user ${existingHealth.userId} - already logged in`);
    return { success: true, userId: existingHealth.userId! };
  }

  logger.info('[Session] Starting interactive session renewal (visible browser)');
  await logSystemEvent('auth', 'Interactive session renewal started - opening browser window');

  // Clean up lock files
  const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  for (const lockFile of lockFiles) {
    const lockPath = path.join(BROWSER_DATA_DIR, lockFile);
    try {
      await fs.unlink(lockPath);
    } catch {
      // Ignore - file may not exist
    }
  }

  // Ensure browser data directory exists
  try {
    await fs.mkdir(BROWSER_DATA_DIR, { recursive: true });
  } catch {
    // Directory may already exist
  }

  let browser: Browser | null = null;

  try {
    // Launch a standalone browser (NOT persistent context) to avoid issues
    browser = await chromium.launch({
      channel: 'chrome', // Use REAL Chrome browser
      headless: false, // VISIBLE browser!
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--start-maximized',
      ],
      timeout: 60000,
    });

    const context = await browser.newContext({
      viewport: null,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    // Load saved cookies if they exist
    try {
      const cookieData = await fs.readFile(cookiesPath, 'utf-8');
      const cookies = JSON.parse(cookieData);
      if (cookies && cookies.length > 0) {
        await context.addCookies(cookies);
        logger.debug(`[Session] Loaded ${cookies.length} saved cookies`);
      }
    } catch {
      logger.debug('[Session] No saved cookies found');
    }

    const page = await context.newPage();

    // Navigate to Facebook
    logger.info('[Session] Navigating to Facebook...');
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait for page to load
    await sleep(3000);

    // Check if already logged in
    let session = await checkSessionCookies(context);

    if (session.hasSession) {
      logger.info(`[Session] Already logged in as ${session.userId}`);
      await saveSessionFromContext(context, cookiesPath, storagePath, session.userId!);
      await browser.close();
      return { success: true, userId: session.userId! };
    }

    // Wait for user to log in
    logger.info('[Session] Waiting for user to log in via browser window...');
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      await sleep(3000); // Check every 3 seconds

      // Check if browser was closed by user
      if (!browser.isConnected()) {
        logger.warn('[Session] Browser was closed by user');
        return { success: false, error: 'Browser window was closed before login completed.' };
      }

      session = await checkSessionCookies(context);

      if (session.hasSession) {
        logger.info(`[Session] Login detected! User ID: ${session.userId}`);
        await logSystemEvent('auth', `Interactive login successful for user ${session.userId}`);

        // Save session
        await saveSessionFromContext(context, cookiesPath, storagePath, session.userId!);

        // Close browser
        await browser.close();

        return { success: true, userId: session.userId! };
      }

      // Also check page content for login indicators
      try {
        const currentUrl = page.url();
        if (
          currentUrl.includes('facebook.com') &&
          !currentUrl.includes('/login') &&
          !currentUrl.includes('/checkpoint')
        ) {
          const pageContent = await page.content();
          const userIdMatch = pageContent.match(/"USER_ID":"(\d{5,})"/);
          if (userIdMatch && userIdMatch[1] !== '0') {
            logger.info(`[Session] Login detected via page content! User ID: ${userIdMatch[1]}`);
            await logSystemEvent('auth', `Interactive login successful for user ${userIdMatch[1]}`);
            await saveSessionFromContext(context, cookiesPath, storagePath, userIdMatch[1]);
            await browser.close();
            return { success: true, userId: userIdMatch[1] };
          }
        }
      } catch {
        // Page might have navigated, ignore errors
      }
    }

    // Timeout
    logger.warn('[Session] Interactive login timed out');
    await logSystemEvent('auth', 'Interactive session renewal timed out - user did not complete login');
    await browser.close();
    return { success: false, error: 'Login timed out. Please try again and complete login within 5 minutes.' };

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Session] Interactive renewal error: ${message}`);
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Ignore close errors
      }
    }
    return { success: false, error: message };
  }
};

/**
 * Helper: Check session from cookies file (without opening browser)
 */
async function checkSessionCookies_fromFile(cookiesPath: string): Promise<{ hasSession: boolean; userId: string | null }> {
  try {
    const cookieData = await fs.readFile(cookiesPath, 'utf-8');
    const cookies = JSON.parse(cookieData);
    const now = Date.now() / 1000;

    const cUser = cookies.find((c: Cookie) => c.name === 'c_user' && (!c.expires || c.expires > now));
    const xs = cookies.find((c: Cookie) => c.name === 'xs' && (!c.expires || c.expires > now));

    return {
      hasSession: Boolean(cUser?.value && xs?.value),
      userId: cUser?.value || null,
    };
  } catch {
    return { hasSession: false, userId: null };
  }
}

/**
 * Helper: Check for Facebook session cookies
 */
async function checkSessionCookies(context: BrowserContext): Promise<{ hasSession: boolean; userId: string | null }> {
  try {
    const cookies = await context.cookies();
    const cUser = cookies.find((c) => c.name === 'c_user');
    const xs = cookies.find((c) => c.name === 'xs');
    return {
      hasSession: Boolean(cUser?.value && xs?.value),
      userId: cUser?.value || null,
    };
  } catch {
    return { hasSession: false, userId: null };
  }
}

/**
 * Helper: Save session data from browser context (cookies, storage state, database)
 */
async function saveSessionFromContext(context: BrowserContext, cookiesFilePath: string, storagePath: string, userId: string): Promise<void> {
  // Import session health functions
  const { markSessionValid } = await import('../session/sessionHealth');
  const prisma = (await import('../database/prisma')).default;

  // Save cookies to file
  const cookies = await context.cookies();
  if (cookies && cookies.length > 0) {
    await fs.writeFile(cookiesFilePath, JSON.stringify(cookies, null, 2));
    logger.info(`[Session] Cookies saved (${cookies.length} cookies) to ${cookiesFilePath}`);
  }

  // Save browser storage state
  await context.storageState({ path: storagePath });
  logger.info('[Session] Browser state saved to disk');

  // Update session health
  await markSessionValid(userId);

  // Update database
  try {
    const existing = await prisma.sessionState.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    const data = {
      status: 'valid' as const,
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
    logger.warn(`[Session] Could not update database: ${(error as Error).message}`);
  }
}
