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
import { loadSessionHealth, markSessionValid, markSessionBlocked } from '../session/sessionHealth';

const cookiesPath = path.resolve(__dirname, '../config/cookies.json');
const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');

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
  await page.waitForTimeout(3000);

  const loginNeeded =
    (await findFirstHandle(page, selectors.loginEmail)).handle ||
    (await findFirstHandle(page, selectors.loginText)).handle;

  if (loginNeeded) {
    await logSystemEvent('auth', 'Facebook session expired. Logging in.');
    await fillFirstMatchingSelector(page, selectors.loginEmail, process.env.FB_EMAIL || '');
    await fillFirstMatchingSelector(page, selectors.loginPassword, process.env.FB_PASSWORD || '');
    await clickFirstMatchingSelector(page, selectors.loginButton);
    await page.waitForTimeout(5000); // Wait for login
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

export const createFacebookContext = async (): Promise<{ browser: Browser; context: BrowserContext }> => {
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

    await page.waitForTimeout(3000);

    const loginNeeded =
      (await findFirstHandle(page, selectors.loginEmail)).handle ||
      (await findFirstHandle(page, selectors.loginText)).handle;

    if (loginNeeded) {
      logger.warn('Persistent browser session not logged in. Attempting login...');
      await fillFirstMatchingSelector(page, selectors.loginEmail, process.env.FB_EMAIL || '');
      await fillFirstMatchingSelector(page, selectors.loginPassword, process.env.FB_PASSWORD || '');
      await clickFirstMatchingSelector(page, selectors.loginButton);
      await page.waitForTimeout(5000);
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

  // Fallback to cookie-based approach (legacy method)
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

  const cookies = await loadCookies();
  if (cookies.length) {
    await context.addCookies(cookies);
  }

  try {
    await ensureLogin(context);
  } catch (error) {
    await browser.close();
    throw error;
  }

  return { browser, context };
};

export const refreshFacebookSession = async (): Promise<void> => {
  const { browser, context } = await createFacebookContext();
  try {
    await saveCookies(context);
    await logSystemEvent('auth', 'Facebook session refreshed via cron');
  } finally {
    await browser.close();
  }
};
