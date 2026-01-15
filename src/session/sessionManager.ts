/**
 * Session Manager
 *
 * Manages the browser session lifecycle with persistent profile support.
 * Uses Playwright with a persistent user data directory to maintain
 * Facebook login sessions across restarts.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'path';
import logger from '../utils/logger';
import prisma from '../database/prisma';
import { sendAlertEmail } from '../utils/alerts';
import { logSystemEvent } from '../utils/systemLog';
import {
  loadSessionHealth,
  updateSessionHealth,
  markSessionValid,
  markSessionExpired,
  markSessionInvalid,
  markSessionBlocked,
  SessionHealthData,
} from './sessionHealth';
import { TIMEOUTS } from '../config/constants';

// Browser data directory for persistent sessions
const BROWSER_DATA_DIR = path.resolve(process.cwd(), 'browser-data');

// Facebook URLs
const FACEBOOK_URL = 'https://www.facebook.com';
const FACEBOOK_LOGIN_URL = 'https://www.facebook.com/login';

// Selectors for login detection
const LOGIN_SELECTORS = {
  emailInput: 'input[name="email"], #email',
  passwordInput: 'input[name="pass"], #pass',
  loginButton: 'button[name="login"], button[type="submit"]',
  loginText: 'text="Log into Facebook", text="Log in to Facebook"',
  twoFactorInput: 'input[name="approvals_code"], input[autocomplete="one-time-code"]',
  captchaText: 'text="security check", text="captcha", text="Confirm your identity"',
  profileMenu: '[aria-label="Your profile"], [aria-label="Account"], [data-pagelet="ProfileActions"]',
  userIdMeta: 'meta[property="al:android:url"]',
};

interface SessionValidationResult {
  isValid: boolean;
  userId: string | null;
  userName: string | null;
  needsLogin: boolean;
  isBlocked: boolean;
  blockReason: string | null;
}

/**
 * Create a browser instance with persistent profile
 *
 * IMPORTANT: Headless mode is enabled by default for stability.
 * The browser runs in background without opening visible windows.
 */
export const createPersistentBrowser = async (headless?: boolean): Promise<{
  browser: Browser;
  context: BrowserContext;
}> => {
  // Default to headless unless explicitly set to false
  const isHeadless = headless ?? process.env.HEADLESS !== 'false';

  logger.info(`Launching browser with persistent profile (headless: ${isHeadless})`);

  // Clean up any stale lock files that might cause crashes
  await cleanupStaleLocks();

  // Launch browser with persistent context - with improved stability settings
  const browser = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: isHeadless,
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'Asia/Jerusalem',
    permissions: ['notifications'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-software-rasterizer',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    timeout: 60000, // 60 second timeout for launch
  });

  // The persistent context is both browser and context
  return { browser: browser as unknown as Browser, context: browser };
};

/**
 * Clean up stale Chrome lock files that can cause crashes
 */
const cleanupStaleLocks = async (): Promise<void> => {
  const fs = await import('fs/promises');
  const lockFile = path.join(BROWSER_DATA_DIR, 'SingletonLock');
  const socketFile = path.join(BROWSER_DATA_DIR, 'SingletonSocket');
  const cookieLock = path.join(BROWSER_DATA_DIR, 'SingletonCookie');

  for (const file of [lockFile, socketFile, cookieLock]) {
    try {
      await fs.unlink(file);
      logger.debug(`Removed stale lock file: ${file}`);
    } catch {
      // File doesn't exist or can't be removed - that's fine
    }
  }
};

/**
 * Check if the current session is logged into Facebook
 */
export const validateSession = async (page: Page): Promise<SessionValidationResult> => {
  const result: SessionValidationResult = {
    isValid: false,
    userId: null,
    userName: null,
    needsLogin: false,
    isBlocked: false,
    blockReason: null,
  };

  try {
    // Navigate to Facebook
    await page.goto(FACEBOOK_URL, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUTS.NAVIGATION,
    });

    // Wait for page to settle
    await page.waitForTimeout(3000);

    // Check for login page indicators
    const hasEmailInput = await page.$(LOGIN_SELECTORS.emailInput);
    const hasLoginText = await page.$('text="Log into Facebook"') || await page.$('text="Log in to Facebook"');

    if (hasEmailInput || hasLoginText) {
      logger.info('Session validation: Login page detected - not logged in');
      result.needsLogin = true;
      return result;
    }

    // Check for 2FA
    const has2FA = await page.$(LOGIN_SELECTORS.twoFactorInput);
    if (has2FA) {
      logger.warn('Session validation: 2FA detected');
      result.isBlocked = true;
      result.blockReason = 'Two-factor authentication required';
      return result;
    }

    // Check for CAPTCHA
    const hasCaptcha = await page.$('text="security check"') || await page.$('text="Confirm your identity"');
    if (hasCaptcha) {
      logger.warn('Session validation: CAPTCHA detected');
      result.isBlocked = true;
      result.blockReason = 'Security captcha required';
      return result;
    }

    // Try to extract user ID from page
    const userId = await extractUserId(page);
    const userName = await extractUserName(page);

    if (userId) {
      result.isValid = true;
      result.userId = userId;
      result.userName = userName;
      logger.info(`Session validation: Valid session for user ${userName || userId}`);
    } else {
      // We're on Facebook but can't find user ID - might be partially logged in
      logger.warn('Session validation: On Facebook but cannot determine user');
      result.needsLogin = true;
    }

    return result;
  } catch (error) {
    logger.error(`Session validation error: ${(error as Error).message}`);
    result.needsLogin = true;
    return result;
  }
};

/**
 * Extract Facebook user ID from page
 */
const extractUserId = async (page: Page): Promise<string | null> => {
  try {
    // Try to get from meta tag
    const metaContent = await page.$eval(
      'meta[property="al:android:url"]',
      (el) => el.getAttribute('content')
    ).catch(() => null);

    if (metaContent) {
      const match = metaContent.match(/fb:\/\/profile\/(\d+)/);
      if (match) return match[1];
    }

    // Try to get from page content
    const pageContent = await page.content();
    const userIdMatch = pageContent.match(/"USER_ID":"(\d+)"/);
    if (userIdMatch) return userIdMatch[1];

    // Try to get from profile link
    const profileLink = await page.$('[aria-label="Your profile"] a, [data-pagelet="ProfileActions"] a');
    if (profileLink) {
      const href = await profileLink.getAttribute('href');
      if (href) {
        const idMatch = href.match(/\/profile\.php\?id=(\d+)/) || href.match(/\/(\d+)\/?$/);
        if (idMatch) return idMatch[1];
      }
    }

    return null;
  } catch (error) {
    logger.debug(`Failed to extract user ID: ${(error as Error).message}`);
    return null;
  }
};

/**
 * Extract user name from page
 */
const extractUserName = async (page: Page): Promise<string | null> => {
  try {
    // Try profile link aria-label
    const profileLink = await page.$('[aria-label="Your profile"]');
    if (profileLink) {
      const label = await profileLink.getAttribute('aria-label');
      if (label && label !== 'Your profile') return label;
    }

    // Try account menu
    const accountMenu = await page.$('[aria-label="Account"]');
    if (accountMenu) {
      await accountMenu.click();
      await page.waitForTimeout(500);
      const nameElement = await page.$('[role="dialog"] span[dir="auto"]');
      if (nameElement) {
        const name = await nameElement.innerText();
        // Close the menu
        await page.keyboard.press('Escape');
        if (name) return name;
      }
    }

    return null;
  } catch (error) {
    logger.debug(`Failed to extract user name: ${(error as Error).message}`);
    return null;
  }
};

/**
 * Perform the full session check and update status
 */
export const checkAndUpdateSession = async (): Promise<SessionHealthData> => {
  logger.info('Starting session check...');

  let context: BrowserContext | null = null;

  try {
    const { context: ctx } = await createPersistentBrowser(true);
    context = ctx;

    const page = await context.newPage();
    const validation = await validateSession(page);

    await page.close();

    if (validation.isBlocked) {
      const health = await markSessionBlocked(validation.blockReason || 'Unknown block');
      await logSystemEvent('auth', `Session blocked: ${validation.blockReason}`);
      await sendAlertEmail(
        'Tarasa Facebook Session Blocked',
        `Your Facebook session requires attention.\n\nReason: ${validation.blockReason}\n\nPlease run: npm run fb:login`
      );

      // Update database
      await updateSessionStateInDb('blocked', validation.blockReason);

      return health;
    }

    if (validation.needsLogin) {
      const health = await markSessionInvalid('Login required');
      await logSystemEvent('auth', 'Session invalid - login required');

      // Update database
      await updateSessionStateInDb('invalid', 'Login required');

      return health;
    }

    if (validation.isValid && validation.userId) {
      const health = await markSessionValid(validation.userId, validation.userName || undefined);
      await logSystemEvent('auth', `Session valid for user ${validation.userName || validation.userId}`);

      // Update database
      await updateSessionStateInDb('valid', null, validation.userId, validation.userName);

      return health;
    }

    // Unknown state
    const health = await updateSessionHealth({ status: 'unknown' });
    return health;

  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Session check failed: ${message}`);
    const health = await markSessionExpired(message);
    await updateSessionStateInDb('expired', message);
    return health;
  } finally {
    if (context) {
      try {
        await (context as BrowserContext).close();
      } catch {
        // Ignore close errors
      }
    }
  }
};

/**
 * Update session state in database
 */
const updateSessionStateInDb = async (
  status: 'valid' | 'expired' | 'invalid' | 'refreshing' | 'blocked' | 'unknown',
  errorMessage: string | null,
  userId?: string | null,
  userName?: string | null
): Promise<void> => {
  try {
    // Get or create the session state record
    const existing = await prisma.sessionState.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      await prisma.sessionState.update({
        where: { id: existing.id },
        data: {
          status,
          lastChecked: new Date(),
          lastValid: status === 'valid' ? new Date() : existing.lastValid,
          errorMessage,
          userId: userId ?? existing.userId,
          userName: userName ?? existing.userName,
        },
      });
    } else {
      await prisma.sessionState.create({
        data: {
          status,
          lastChecked: new Date(),
          lastValid: status === 'valid' ? new Date() : null,
          errorMessage,
          userId,
          userName,
        },
      });
    }
  } catch (error) {
    logger.error(`Failed to update session state in database: ${(error as Error).message}`);
  }
};

/**
 * Get current session state from database
 */
export const getSessionStateFromDb = async () => {
  try {
    return await prisma.sessionState.findFirst({
      orderBy: { createdAt: 'desc' },
    });
  } catch (error) {
    logger.error(`Failed to get session state from database: ${(error as Error).message}`);
    return null;
  }
};

/**
 * Create a browser context for scraping (uses persistent profile)
 */
export const createScrapingContext = async (): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> => {
  const { browser, context } = await createPersistentBrowser();
  const page = await context.newPage();
  return { browser, context, page };
};

/**
 * Check if session is valid without creating a new browser
 */
export const isSessionValid = async (): Promise<boolean> => {
  const health = await loadSessionHealth();
  return health.status === 'valid';
};

/**
 * Initialize session on startup - validates and syncs session state
 * Call this before starting cron jobs to ensure session is ready
 */
export const initializeSession = async (): Promise<{ ready: boolean; message: string }> => {
  logger.info('Initializing session on startup...');

  try {
    // Load file-based session health
    const fileHealth = await loadSessionHealth();

    // Get database session state
    const dbState = await getSessionStateFromDb();

    // Check for desync between file and DB
    if (dbState && fileHealth.status !== dbState.status) {
      logger.warn(`Session state desync detected: file=${fileHealth.status}, db=${dbState.status}`);

      // Trust the most recent valid state
      if (dbState.status === 'valid' && fileHealth.status !== 'valid') {
        // DB says valid but file doesn't - verify with actual check
        logger.info('Verifying session validity...');
        await checkAndUpdateSession();
      }
    }

    // Reload after potential sync
    const currentHealth = await loadSessionHealth();

    if (currentHealth.status === 'valid') {
      logger.info(`Session ready: user ${currentHealth.userId || 'unknown'}`);
      return { ready: true, message: `Session valid for user ${currentHealth.userId}` };
    }

    if (currentHealth.status === 'blocked') {
      logger.error('Session is blocked - manual intervention required');
      await logSystemEvent('auth', 'Session blocked on startup - requires manual login');
      return { ready: false, message: `Session blocked: ${currentHealth.errorMessage}` };
    }

    // Session not valid - check if it's just expired/unknown and needs refresh
    if (currentHealth.status === 'expired' || currentHealth.status === 'unknown') {
      logger.info('Session expired or unknown - attempting validation...');
      const newHealth = await checkAndUpdateSession();

      if (newHealth.status === 'valid') {
        logger.info('Session validated successfully');
        return { ready: true, message: 'Session validated on startup' };
      }
    }

    // Session invalid or needs login
    logger.warn(`Session not ready: ${currentHealth.status}`);
    return { ready: false, message: `Session status: ${currentHealth.status}` };

  } catch (error) {
    const message = (error as Error).message;
    logger.error(`Session initialization failed: ${message}`);
    return { ready: false, message: `Initialization error: ${message}` };
  }
};

/**
 * Get session status summary
 */
export const getSessionStatus = async (): Promise<{
  loggedIn: boolean;
  userId: string | null;
  userName: string | null;
  status: string;
  lastChecked: string;
  canAccessPrivateGroups: boolean;
  requiresAction: boolean;
}> => {
  const health = await loadSessionHealth();
  const dbState = await getSessionStateFromDb();

  return {
    loggedIn: health.status === 'valid',
    userId: health.userId || dbState?.userId || null,
    userName: health.userName || dbState?.userName || null,
    status: health.status,
    lastChecked: health.lastChecked,
    canAccessPrivateGroups: health.canAccessPrivateGroups,
    requiresAction: health.status === 'invalid' || health.status === 'blocked',
  };
};
