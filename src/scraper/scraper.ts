import { chromium, BrowserContext } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { selectors } from '../utils/selectors';
import { humanDelay } from '../utils/delays';
import { extractPosts } from './extractors';
import prisma from '../database/prisma';

const cookiesPath = path.resolve(__dirname, '../config/cookies.json');

const getGroupUrls = (): string[] => {
  const ids = process.env.GROUP_IDS?.split(',').map((id) => id.trim()).filter(Boolean) || [];
  return ids.map((id) => `https://www.facebook.com/groups/${id}`);
};

const loadCookies = async (): Promise<any[]> => {
  try {
    const raw = await fs.readFile(cookiesPath, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    logger.warn('Cookies file missing, returning empty array');
    return [];
  }
};

const saveCookies = async (context: BrowserContext) => {
  const cookies = await context.cookies();
  await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
  logger.info('Cookies saved');
};

const ensureLogin = async (context: BrowserContext) => {
  const page = await context.newPage();
  await page.goto('https://www.facebook.com');
  await page.waitForLoadState('domcontentloaded');

  const loginNeeded = await page.$(selectors.loginEmail);

  if (loginNeeded) {
    logger.info('Login required, entering credentials');
    await page.fill(selectors.loginEmail, process.env.FB_EMAIL || '');
    await page.fill(selectors.loginPassword, process.env.FB_PASSWORD || '');
    await page.click(selectors.loginButton);
    await page.waitForLoadState('networkidle');
    await humanDelay();
    await saveCookies(context);
  } else {
    logger.info('Existing session detected');
  }

  await page.close();
};

export const scrapeGroups = async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();

  const cookies = await loadCookies();
  if (cookies.length) {
    await context.addCookies(cookies);
  }

  await ensureLogin(context);

  const page = await context.newPage();
  const groups = getGroupUrls();

  for (const groupUrl of groups) {
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
    logger.info(`Scraping group ${groupUrl}`);

    for (let i = 0; i < 5; i++) {
      await page.evaluate('window.scrollBy(0, 800)');
      await humanDelay();
    }

    const posts = await extractPosts(page);

    for (const post of posts) {
      await prisma.postRaw.upsert({
        where: { fbPostId: post.fbPostId },
        update: {
          text: post.text,
          authorName: post.authorName,
          authorLink: post.authorLink,
        },
        create: {
          fbPostId: post.fbPostId,
          groupId: groupUrl,
          text: post.text,
          authorName: post.authorName,
          authorLink: post.authorLink,
        },
      });
    }
  }

  await saveCookies(context);
  await browser.close();
};
