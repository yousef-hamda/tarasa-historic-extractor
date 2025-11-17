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

const cookiesPath = path.resolve(__dirname, '../config/cookies.json');

export const loadCookies = async (): Promise<any[]> => {
  try {
    const raw = await fs.readFile(cookiesPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

export const saveCookies = async (context: BrowserContext) => {
  const cookies = await context.cookies();
  await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
  logger.info('Cookies saved');
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

export const ensureLogin = async (context: BrowserContext) => {
  const page = await context.newPage();
  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');

  const loginNeeded =
    (await findFirstHandle(page, selectors.loginEmail)).handle ||
    (await findFirstHandle(page, selectors.loginText)).handle;

  if (loginNeeded) {
    await logSystemEvent('auth', 'Facebook session expired. Logging in.');
    await fillFirstMatchingSelector(page, selectors.loginEmail, process.env.FB_EMAIL || '');
    await fillFirstMatchingSelector(page, selectors.loginPassword, process.env.FB_PASSWORD || '');
    await clickFirstMatchingSelector(page, selectors.loginButton);
    await page.waitForLoadState('networkidle');
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
  const browser = await chromium.launch({ headless: false });
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

export const refreshFacebookSession = async () => {
  const { browser, context } = await createFacebookContext();
  try {
    await saveCookies(context);
    await logSystemEvent('auth', 'Facebook session refreshed via cron');
  } finally {
    await browser.close();
  }
};
