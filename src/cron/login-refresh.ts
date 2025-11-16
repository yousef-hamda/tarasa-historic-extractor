import cron from 'node-cron';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger';
import { selectors } from '../utils/selectors';

const cookiesPath = path.resolve(__dirname, '../config/cookies.json');

const refreshCookies = async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' });

  const loginNeeded = await page.$(selectors.loginEmail);
  if (loginNeeded) {
    await page.fill(selectors.loginEmail, process.env.FB_EMAIL || '');
    await page.fill(selectors.loginPassword, process.env.FB_PASSWORD || '');
    await page.click(selectors.loginButton);
    await page.waitForLoadState('networkidle');
  }

  const cookies = await context.cookies();
  await fs.writeFile(cookiesPath, JSON.stringify(cookies, null, 2));
  await browser.close();
};

cron.schedule('0 0 * * *', async () => {
  logger.info('Refreshing Facebook login session');
  await refreshCookies();
});
