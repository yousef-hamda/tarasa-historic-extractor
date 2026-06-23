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

// ---------------------------------------------------------------------------
// Resilient Chromium launch
//
// On Railway (memory-constrained container) chrome-headless-shell intermittently
// crashes during startup with:
//   browserType.launch: Target page, context or browser has been closed
//   ... <process did exit: exitCode=null, signal=SIGTRAP>
// SIGTRAP at startup is chrome's __builtin_trap() crash — almost always
// transient memory pressure rather than a deterministic config error (other
// groups in the same cron succeed). Retrying after a short backoff gives the OS
// time to reclaim memory from the previous (now-closed) browser, so the next
// attempt usually launches cleanly.
// ---------------------------------------------------------------------------

// Stability + memory-footprint flags shared by the headless scraping launches.
// Fewer renderer processes (site-per-process off) and a capped V8 heap make the
// container far less likely to OOM a chrome startup.
const SCRAPER_LAUNCH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-software-rasterizer',
  // Memory-pressure reducers (the SIGTRAP fix):
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=site-per-process,Translate,BackForwardCache',
  '--js-flags=--max-old-space-size=512',
  '--mute-audio',
];

// Keep the total launch budget bounded: a hung chrome launch must not sit
// holding the single browser-pool slot. 2 attempts × 45s + ~2s backoff ≈ 92s,
// comfortably under the per-scrape watchdog (150s) and pool timeout.
const LAUNCH_MAX_ATTEMPTS = 2;
const LAUNCH_TIMEOUT_MS = 45_000;

const isTransientLaunchError = (message: string): boolean => {
  const m = message.toLowerCase();
  return (
    m.includes('target page, context or browser has been closed') ||
    m.includes('target closed') ||
    m.includes('sigtrap') ||
    m.includes('signal=sig') ||
    m.includes('browser has been closed') ||
    m.includes('browsertype.launch') ||
    m.includes('failed to launch') ||
    m.includes('crashed')
  );
};

/**
 * Launch headless Chromium with a bounded timeout and backoff retry on the
 * transient startup crashes (SIGTRAP / "Target closed") that Railway exhibits
 * under memory pressure. Non-transient errors are thrown immediately.
 */
const launchChromiumWithRetry = async (
  overrides: Parameters<typeof chromium.launch>[0] = {}
): Promise<Browser> => {
  const headless = process.env.HEADLESS !== 'false';
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= LAUNCH_MAX_ATTEMPTS; attempt++) {
    try {
      return await chromium.launch({
        headless,
        args: SCRAPER_LAUNCH_ARGS,
        timeout: LAUNCH_TIMEOUT_MS,
        ...overrides,
      });
    } catch (error) {
      lastError = error as Error;
      const message = lastError.message || String(error);
      if (attempt < LAUNCH_MAX_ATTEMPTS && isTransientLaunchError(message)) {
        // Exponential-ish backoff: 2s, 4s. Gives the kernel time to reclaim
        // memory from the crashed/closed chrome before the next attempt.
        const backoffMs = 2000 * attempt;
        logger.warn(
          `[Session] Chromium launch attempt ${attempt}/${LAUNCH_MAX_ATTEMPTS} crashed (${message.split('\n')[0]}). Retrying in ${backoffMs}ms...`
        );
        await sleep(backoffMs);
        continue;
      }
      throw lastError;
    }
  }

  // Unreachable, but satisfies the type checker.
  throw lastError ?? new Error('Chromium launch failed for an unknown reason');
};

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

// ---------------------------------------------------------------------------
// Cookie persistence
//
// Railway's container filesystem is ephemeral — every redeploy wipes
// src/config/cookies.json, so without DB persistence the FB session is lost
// on every push. We solve this by ALSO writing cookies to a TEXT column on
// the SessionState row. On startup we restore the JSON file from DB if the
// file is missing.
// ---------------------------------------------------------------------------

const persistCookiesToDb = async (cookies: Cookie[]): Promise<void> => {
  if (!cookies || cookies.length === 0) return;
  try {
    const prisma = (await import('../database/prisma')).default;
    const cookiesJson = JSON.stringify(cookies);
    const existing = await prisma.sessionState.findFirst({ orderBy: { createdAt: 'desc' } });
    if (existing) {
      await prisma.sessionState.update({
        where: { id: existing.id },
        data: { cookiesJson, updatedAt: new Date() },
      });
    } else {
      await prisma.sessionState.create({
        data: { status: 'valid', cookiesJson, lastValid: new Date() },
      });
    }
    logger.debug(`Persisted ${cookies.length} cookies to SessionState.cookiesJson`);
  } catch (error) {
    // Persistence to DB is best-effort. We don't fail the operation if it
    // hiccups — the JSON file write is the primary path.
    logger.warn(`Failed to persist cookies to DB (continuing): ${(error as Error).message}`);
  }
};

const restoreCookiesFromDb = async (): Promise<Cookie[] | null> => {
  try {
    const prisma = (await import('../database/prisma')).default;
    const row = await prisma.sessionState.findFirst({
      where: { cookiesJson: { not: null } },
      orderBy: { updatedAt: 'desc' },
    });
    if (!row || !row.cookiesJson) return null;
    const parsed = JSON.parse(row.cookiesJson) as Cookie[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    logger.info(`[Session] Restored ${parsed.length} cookies from DB (file was missing or empty)`);
    return parsed;
  } catch (error) {
    logger.warn(`Failed to restore cookies from DB: ${(error as Error).message}`);
    return null;
  }
};

export const loadCookies = async (): Promise<Cookie[]> => {
  // Primary path: read the on-disk JSON file. Fast and avoids hitting the
  // DB on every scrape attempt.
  try {
    const raw = await fs.readFile(cookiesPath, 'utf-8');
    const cookies: Cookie[] = JSON.parse(raw);
    const now = Date.now() / 1000;

    const validCookies = cookies.filter((cookie) => !cookie.expires || cookie.expires > now);
    if (cookies.length !== validCookies.length) {
      logger.warn(`Pruned ${cookies.length - validCookies.length} expired cookies from saved session`);
    }
    if (validCookies.length > 0) {
      return validCookies;
    }
    // File exists but has no valid cookies — fall through to DB restore
    logger.warn('cookies.json has 0 valid cookies; falling back to DB restore');
  } catch (error) {
    logger.debug(`No existing cookies file (${(error as Error).message}); checking DB`);
  }

  // Fallback: file missing or empty — restore from DB (Railway redeploy case).
  const restored = await restoreCookiesFromDb();
  if (restored && restored.length > 0) {
    // Write restored cookies back to the JSON file so subsequent reads are
    // fast and the rest of the app sees the canonical file.
    try {
      await fs.writeFile(cookiesPath, JSON.stringify(restored, null, 2));
      logger.info('[Session] Wrote DB-restored cookies back to cookies.json');
    } catch (e) {
      logger.warn(`Could not write DB-restored cookies to file: ${(e as Error).message}`);
    }
    return restored;
  }

  return [];
};

/**
 * True if a cookie array carries a usable logged-in Facebook session: a
 * non-empty `c_user` (the account id) AND a non-empty, non-expired `xs` (the
 * session secret). This is the same notion `getCookieHealth()` uses to gate
 * scraping, factored out so the cookie-save guard and tests share one
 * definition of "is this actually a logged-in session".
 */
export const cookiesCarryValidSession = (cookies: Cookie[]): boolean => {
  if (!Array.isArray(cookies) || cookies.length === 0) return false;
  const now = Date.now() / 1000;
  const present = (name: string) =>
    cookies.some(
      (c) =>
        c.name === name &&
        c.domain.includes('facebook.com') &&
        !!c.value &&
        (!c.expires || c.expires > now)
    );
  return present('c_user') && present('xs');
};

export const saveCookies = async (context: BrowserContext): Promise<void> => {
  try {
    const cookies = await context.cookies();
    if (!cookies || cookies.length === 0) {
      logger.warn('No cookies to save');
      return;
    }

    // GUARD against self-inflicted session loss.
    //
    // `saveCookies` runs after EVERY scrape and message send. Facebook — hostile
    // to Railway's datacenter IP — intermittently serves a logged-out/checkpoint
    // response mid-scrape, which strips c_user/xs from the live context. Public-
    // group scrapes also run with NO auth cookies by design. In both cases the
    // context still holds some cookies (datr/sb/fr…), so an unconditional save
    // used to overwrite the canonical store AND its DB mirror with a logged-out
    // set — killing scraping until a manual cookie re-upload (the "session dies
    // after ~1 day" bug). If the live context has no valid session but we DO
    // have a good one stored, keep the stored cookies and skip the write.
    if (!cookiesCarryValidSession(cookies as Cookie[])) {
      const existing = await loadCookies().catch(() => [] as Cookie[]);
      if (cookiesCarryValidSession(existing)) {
        logger.warn(
          '[Session] Live browser context has no valid FB session (c_user/xs missing or expired) — NOT overwriting the stored good cookies. Facebook likely served a logged-out response, or this was a public-mode scrape.'
        );
        await logSystemEvent(
          'auth',
          'Skipped cookie save: context carried no valid session (preserving stored cookies)'
        ).catch(() => {});
        return;
      }
      // No good session stored either — saving is harmless (and may legitimately
      // capture public/anon cookies), so fall through to persist.
    }

    await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
    logger.info(`Cookies saved (${cookies.length} cookies)`);
    // Mirror to DB so the session survives Railway redeploys
    await persistCookiesToDb(cookies as Cookie[]);
  } catch (error) {
    // Don't throw - cookie saving is not critical
    logger.warn(`Failed to save cookies: ${(error as Error).message}`);
  }
};

// Exported so the upload-cookies route can mirror to DB directly without
// having to spin up a BrowserContext just to save.
export const persistCookiesArrayToDb = persistCookiesToDb;

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

  // Use the shared definition of "logged-in session" (c_user + non-expired xs)
  // so the scraping gate and the cookie-save guard never disagree.
  const hasValidSession = cookiesCarryValidSession(cookies);

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

  // telegram: true — FB challenges are the highest-urgency alert; the
  // operator must intervene NOW or scraping stays dark until they do.
  await logSystemEvent('auth', message, { telegram: true });
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
export const createFacebookContext = async (options?: { publicGroupMode?: boolean; skipLogin?: boolean }): Promise<{ browser: Browser; context: BrowserContext }> => {
  const { publicGroupMode = false, skipLogin = false } = options || {};

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
  // launchChromiumWithRetry adds a launch timeout + backoff retry so the
  // transient SIGTRAP startup crash on Railway no longer fails the whole scrape.
  const browser = await launchChromiumWithRetry();
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

    // Verify login for authenticated operations.
    //
    // The scraper passes skipLogin: true — it has already confirmed a valid
    // session via getCookieHealth() and loaded the cookies above, so the extra
    // facebook.com round-trip ensureLogin does is pure overhead AND a hang risk:
    // it runs BEFORE createFacebookContext returns (so the per-scrape watchdog
    // has no browser handle yet to abort it) and uses the 90s NAVIGATION
    // timeout. It was the main cause of heavy groups wedging at the pool
    // timeout. Skipping it also reduces datacenter-IP anti-bot exposure (fewer
    // facebook.com home visits / no per-scrape credential re-login). Callers
    // that genuinely need a verified login (messenger, refresh) leave skipLogin
    // false and keep ensureLogin.
    if (!skipLogin) {
      try {
        await ensureLogin(context);
      } catch (error) {
        await browser.close();
        throw error;
      }
    } else {
      logger.info('[Session] skipLogin set — using loaded cookies without a facebook.com re-verification round-trip');
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

export interface StealthLoginCredentials {
  email?: string;
  password?: string;
  /** Optional one-time TOTP code supplied by the user for this login attempt. */
  totpCode?: string;
}

export const stealthRefreshFacebookSession = async (
  credentials?: StealthLoginCredentials
): Promise<{
  success: boolean;
  error?: string;
  challenge?: 'captcha' | '2fa' | 'checkpoint' | null;
  userId?: string;
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
  const email = (credentials?.email || process.env.FB_EMAIL || '').trim();
  const password = credentials?.password || process.env.FB_PASSWORD || '';
  const oneTimeTotpCode = credentials?.totpCode?.replace(/\s+/g, '').trim();

  if (!email || !password) {
    return {
      success: false,
      error: 'Facebook email or password is missing. Enter them in the dashboard or set FB_EMAIL / FB_PASSWORD env vars.',
    };
  }

  try {
    logger.info('[StealthLogin] Launching stealth browser');
    const result = await createStealthBrowser({
      headless: true,
      useRealChrome: false, // Railway only ships Playwright Chromium, no system Chrome
    });
    context = result.context;

    // Wipe any cookies from prior failed attempts. The stealth browser uses a
    // persistent context (browser-data/) so state survives across calls; if a
    // previous attempt left us mid-login (e.g. a /two_step_verification/ page),
    // navigating back to facebook.com would redirect us into the same partial
    // state instead of showing the login form. Clearing cookies guarantees a
    // fresh login flow each time. The browser fingerprint (UA, viewport, etc.)
    // is preserved since that lives in browser-data/ as profile prefs, not as
    // cookies.
    try {
      await context.clearCookies();
      logger.info('[StealthLogin] Cleared cookies from persistent context');
    } catch (clearErr) {
      logger.warn(`[StealthLogin] Could not clear cookies (continuing anyway): ${(clearErr as Error).message}`);
    }

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
      // Three ways to satisfy 2FA, in order of preference:
      //   1. A one-time code the user typed into the dashboard right now.
      //   2. A TOTP secret stored on the server (FB_TOTP_SECRET env var),
      //      from which we generate the current code on the fly.
      //   3. Nothing — bail with a helpful error so the dashboard can prompt
      //      the user for a code and retry.
      let code: string | null = null;

      if (oneTimeTotpCode && /^\d{6,8}$/.test(oneTimeTotpCode)) {
        code = oneTimeTotpCode;
        logger.info('[StealthLogin] Using one-time TOTP code from request body');
      } else {
        const totpSecret = process.env.FB_TOTP_SECRET?.trim().replace(/\s+/g, '');
        if (!totpSecret) {
          logger.warn('[StealthLogin] 2FA required but no code or FB_TOTP_SECRET available');
          return {
            success: false,
            error:
              'Facebook is asking for a 2FA code. Enter the 6-digit code from your authenticator app and try again.',
            challenge: '2fa',
          };
        }
        try {
          const otp = await import('otplib');
          // `plugins` is accepted at runtime (the documented way to bind crypto
          // + base32 plugins) but missing from otplib v13's type defs.
          code = otp.generateSync({
            secret: totpSecret,
            plugins: [otp.NobleCryptoPlugin, otp.ScureBase32Plugin],
          } as Parameters<typeof otp.generateSync>[0] & { plugins: unknown[] });
          logger.info('[StealthLogin] Submitting TOTP code generated from FB_TOTP_SECRET');
        } catch (genErr) {
          return {
            success: false,
            error: `Could not generate TOTP code: ${(genErr as Error).message}. Enter the 6-digit code from your authenticator app instead.`,
            challenge: '2fa',
          };
        }
      }

      try {

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

        // If we're STILL on the 2FA page after submitting the code, Facebook
        // rejected it (wrong code, or code expired before we typed it). Tell
        // the user clearly so they know to grab a fresh code from their
        // authenticator app — the generic "no session cookies" error below
        // would be confusing.
        const postSubmitUrl = page.url().toLowerCase();
        if (
          postSubmitUrl.includes('/two_step_verification/') ||
          postSubmitUrl.includes('/two_factor/') ||
          postSubmitUrl.includes('/login/checkpoint')
        ) {
          logger.warn(`[StealthLogin] Still on 2FA page after submitting code (URL: ${postSubmitUrl}). FB rejected the code.`);
          return {
            success: false,
            error: "Facebook didn't accept that 2FA code. Open your authenticator app, grab the CURRENT 6-digit code (codes rotate every 30 seconds), enter it, and try again.",
            challenge: '2fa',
          };
        }

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
    // Mirror to DB so cookies survive Railway container restarts.
    await persistCookiesToDb(cookiesNow as Cookie[]);
    logger.info(
      `[StealthLogin] SUCCESS — captured ${cookiesNow.length} cookies for user ${cUser.value}`
    );

    await page.close();
    return { success: true, userId: cUser.value };
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
