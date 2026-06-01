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

// ============================================================================
// Stealth-mode auto-login (no real display required)
//
// Uses the repo's existing stealthBrowser configuration (navigator.webdriver
// override, WebGL spoofing, human-like typing, random mouse movement) to
// dramatically reduce Facebook's automated-login detection rate compared to
// the plain Playwright launch that refreshFacebookSession() uses.
//
// Verified locally before being wired into the dashboard's renew flow.
// ============================================================================

export const stealthRefreshFacebookSession = async (): Promise<{
  success: boolean;
  error?: string;
  challenge?: 'captcha' | '2fa' | 'checkpoint' | null;
}> => {
  // Dynamic import so importing this file doesn't load the stealth machinery
  // unless we actually use it (keeps cron startup time down).
  const {
    createStealthBrowser,
    humanType,
    humanDelay: stealthHumanDelay,
    randomMouseMovement,
    checkForBotDetection,
  } = await import('../scraper/stealthBrowser');

  let context: BrowserContext | null = null;
  const email = process.env.FB_EMAIL || '';
  const password = process.env.FB_PASSWORD || '';

  if (!email || !password) {
    return { success: false, error: 'FB_EMAIL or FB_PASSWORD env vars are not set.' };
  }

  try {
    logger.info('[StealthLogin] Launching stealth browser');
    const result = await createStealthBrowser({
      headless: true,
      useRealChrome: false, // Railway only ships Playwright Chromium, no system Chrome
    });
    context = result.context;

    const page = await context.newPage();
    page.setDefaultTimeout(45_000);

    logger.info('[StealthLogin] Navigating to facebook.com');
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    await stealthHumanDelay(1000, 2000);
    await randomMouseMovement(page);

    // Did the persistent stealth profile keep us logged in from a prior session?
    const alreadyIn = await page.evaluate(() => {
      const cookieMap = document.cookie.split('; ').reduce<Record<string, string>>((acc, c) => {
        const [k, v] = c.split('=');
        if (k) acc[k] = v;
        return acc;
      }, {});
      return Boolean(cookieMap.c_user);
    });
    if (alreadyIn) {
      logger.info('[StealthLogin] Already logged in via persistent profile cookies');
    } else {
      // Find the email field. FB occasionally renders #email vs input[name="email"].
      logger.info('[StealthLogin] Waiting for login form');
      const emailSelector = await page.waitForSelector(
        'input[name="email"], #email',
        { timeout: 15_000 }
      );
      if (!emailSelector) {
        return { success: false, error: 'Login form not found on facebook.com.' };
      }

      // Pick the first selector from each readonly tuple
      const emailSel = (selectors.loginEmail as readonly string[])[0];
      const passSel = (selectors.loginPassword as readonly string[])[0];

      logger.info('[StealthLogin] Typing credentials (human-like)');
      await humanType(page, emailSel, email);
      await stealthHumanDelay(500, 1500);
      await humanType(page, passSel, password);
      await stealthHumanDelay(800, 2000);
      await randomMouseMovement(page);

      logger.info('[StealthLogin] Clicking login button');
      await clickFirstMatchingSelector(page, selectors.loginButton);

      // Wait for the post-click navigation to settle. FB's homepage keeps making
      // background requests so 'networkidle' rarely fires; rely on a 'load' wait
      // + a single fixed buffer + cookie probe instead.
      await page.waitForLoadState('load', { timeout: 20_000 }).catch(() => undefined);
      await stealthHumanDelay(3000, 5000);
    }

    // Did Facebook show a challenge?
    //
    // The most reliable signal is the URL. Playwright's page.url() reads from
    // the browser process so it survives in-page navigation — unlike
    // page.evaluate(() => location.href) which can throw "Execution context
    // was destroyed" mid-redirect.
    let challengeInfo: string | null = null;
    const checkUrl = (rawUrl: string): string | null => {
      const u = rawUrl.toLowerCase();
      if (
        u.includes('/two_step_verification/') ||
        u.includes('/two_factor/') ||
        u.includes('/login/checkpoint')
      ) {
        return '2fa';
      }
      if (u.includes('/checkpoint')) {
        return 'checkpoint';
      }
      return null;
    };
    challengeInfo = checkUrl(page.url());

    // If URL didn't match a known challenge pattern, attempt the in-page text
    // probe as a fallback (handles cases where FB renders the challenge UI in
    // the body without changing the URL). Wrapped in try/catch because the
    // execution context can vanish mid-navigation.
    if (!challengeInfo) {
      try {
        challengeInfo = await page.evaluate(() => {
          const text = (document.body.innerText || '').toLowerCase();
          if (
            text.includes('two-factor') ||
            text.includes('two-step verification') ||
            text.includes('enter security code') ||
            text.includes('enter the code') ||
            document.querySelector('input[name="approvals_code"]')
          ) {
            return '2fa';
          }
          if (
            text.includes('security check') ||
            text.includes('captcha') ||
            text.includes('confirm your identity')
          ) {
            return 'captcha';
          }
          if (
            text.includes('please confirm') ||
            text.includes("verify it's you")
          ) {
            return 'checkpoint';
          }
          return null;
        });
      } catch (evalErr) {
        logger.debug(`[StealthLogin] Text probe failed (mid-navigation): ${(evalErr as Error).message}`);
        // Give navigation a moment to settle, then re-check the URL.
        await new Promise((r) => setTimeout(r, 2500));
        challengeInfo = checkUrl(page.url());
      }
    }

    if (challengeInfo === '2fa') {
      // 2FA can be solved automatically when the user has shared their TOTP
      // secret via the FB_TOTP_SECRET env var (extracted once from Facebook's
      // "set up authenticator app" screen).
      const totpSecret = process.env.FB_TOTP_SECRET?.trim().replace(/\s+/g, '');
      if (!totpSecret) {
        logger.warn('[StealthLogin] 2FA required but FB_TOTP_SECRET is not set');
        return {
          success: false,
          error:
            'Facebook is asking for a 2FA code. Set FB_TOTP_SECRET env var (TOTP secret from FB → Security → Two-factor authentication → Authentication app) to enable automated 2FA. Or use manual cookie upload.',
          challenge: '2fa',
        };
      }

      try {
        const otp = await import('otplib');
        // `plugins` is accepted at runtime (the documented way to bind crypto
        // + base32 plugins) but missing from otplib v13's type defs.
        const code = otp.generateSync({
          secret: totpSecret,
          plugins: [otp.NobleCryptoPlugin, otp.ScureBase32Plugin],
        } as Parameters<typeof otp.generateSync>[0] & { plugins: unknown[] });
        logger.info('[StealthLogin] Submitting TOTP code from FB_TOTP_SECRET');

        // Find the 2FA code input — FB uses several selectors over the years
        const codeInputSelectors = [
          'input[name="approvals_code"]',
          'input[autocomplete="one-time-code"]',
          'input[name="approvals_code_pin"]',
          'input[type="text"][maxlength="6"]',
          'input[id="approvals_code"]',
        ];
        let codeInputSel: string | null = null;
        for (const sel of codeInputSelectors) {
          if (await page.$(sel)) { codeInputSel = sel; break; }
        }
        if (!codeInputSel) {
          return {
            success: false,
            error: 'Detected 2FA page but could not find the code input field. Selectors may have changed; use manual cookie upload.',
            challenge: '2fa',
          };
        }
        await humanType(page, codeInputSel, code);
        await stealthHumanDelay(700, 1300);

        // Click Continue / Submit
        const continueSelectors = [
          'button[type="submit"]',
          'input[type="submit"]',
          'div[role="button"][aria-label="Continue"]',
          'div[role="button"][aria-label="Submit"]',
          'div[role="button"]:has-text("Continue")',
          'button:has-text("Continue")',
        ];
        let continueClicked = false;
        for (const sel of continueSelectors) {
          const el = await page.$(sel);
          if (el) {
            await el.click().catch(() => undefined);
            continueClicked = true;
            break;
          }
        }
        if (!continueClicked) {
          return {
            success: false,
            error: 'Submitted TOTP code but could not find the Continue button.',
            challenge: '2fa',
          };
        }

        await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
        await stealthHumanDelay(2500, 4000);

        // FB may now show "Save browser?" — try to dismiss with "Not now" or
        // click Continue if present.
        try {
          const saveBrowserBtn = await page.$('div[role="button"]:has-text("Continue")');
          if (saveBrowserBtn) {
            await saveBrowserBtn.click().catch(() => undefined);
            await stealthHumanDelay(2000, 3500);
          }
        } catch { /* ignore */ }

        logger.info('[StealthLogin] TOTP submitted, continuing to cookie verification');
      } catch (totpErr) {
        return {
          success: false,
          error: `Failed during 2FA handling: ${(totpErr as Error).message}. Use manual cookie upload.`,
          challenge: '2fa',
        };
      }
    } else if (challengeInfo) {
      logger.warn(`[StealthLogin] Facebook challenge detected: ${challengeInfo}`);
      return {
        success: false,
        error: `Facebook is asking for ${challengeInfo === 'captcha' ? 'a captcha' : 'identity verification'} — the server cannot answer this. Use manual cookie upload.`,
        challenge: challengeInfo as 'captcha' | 'checkpoint',
      };
    }

    // Generic bot-detection sniff (existing helper)
    if (await checkForBotDetection(page)) {
      return {
        success: false,
        error: 'Facebook bot-detection page reached. Use manual cookie upload.',
        challenge: 'checkpoint',
      };
    }

    // Verify we got the session cookies
    const cookiesNow = await context.cookies();
    const cUser = cookiesNow.find((c) => c.name === 'c_user' && c.domain.includes('facebook.com'));
    const xs = cookiesNow.find((c) => c.name === 'xs' && c.domain.includes('facebook.com'));

    if (!cUser || !xs) {
      // Capture diagnostics so we can see EXACTLY why FB rejected
      const diag = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        // Look for any error-like text near the login form
        bodyTextPreview: (document.body.innerText || '').slice(0, 600),
        hasEmailInput: !!document.querySelector('input[name="email"], #email'),
        hasPassInput: !!document.querySelector('input[name="pass"], #pass'),
        cookieNames: document.cookie.split('; ').map((c) => c.split('=')[0]).filter(Boolean),
      }));
      logger.warn(
        `[StealthLogin] No session cookies. URL=${diag.url} title="${diag.title}" cookies=[${diag.cookieNames.join(',')}]`
      );
      logger.warn(`[StealthLogin] Page text preview: ${diag.bodyTextPreview.replace(/\s+/g, ' ')}`);
      return {
        success: false,
        error: `Login completed but no session cookies were issued (c_user=${!!cUser}, xs=${!!xs}). Facebook URL after login: ${diag.url}. Page title: "${diag.title}".`,
      };
    }

    // Persist to the canonical cookies.json the rest of the app reads from.
    await fs.writeFile(cookiesPath, JSON.stringify(cookiesNow, null, 2));
    logger.info(
      `[StealthLogin] SUCCESS — captured ${cookiesNow.length} cookies for user ${cUser.value}`
    );

    await page.close();
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[StealthLogin] Error: ${message}`);
    return { success: false, error: message };
  } finally {
    if (context) {
      const { safeCloseBrowser } = await import('../scraper/stealthBrowser');
      await safeCloseBrowser(context).catch(() => undefined);
    }
  }
};
