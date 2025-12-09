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

const cookiesPath = path.resolve(__dirname, '../config/cookies.json');

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
  const cookies = await context.cookies();
  await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
  logger.info('Cookies saved');
};

export const getCookieHealth = async () => {
  const cookies = await loadCookies();
  const now = Date.now() / 1000;
  const valid = cookies.filter((cookie) => !cookie.expires || cookie.expires > now + 300);

  return {
    ok: valid.length > 0,
    total: cookies.length,
    valid: valid.length,
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
  // Allow headless mode via environment variable (default: false for Facebook detection avoidance)
  const headless = process.env.HEADLESS === 'true';
  const browser = await chromium.launch({ headless });
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
