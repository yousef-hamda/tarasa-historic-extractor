import type { BrowserContextOptions, LaunchOptions } from 'playwright';

const launchOptions: LaunchOptions = {
  timeout: 180000, // Increased to 3 minutes
  headless: process.env.NODE_ENV === 'production',
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
  ],
};

const contextOptions: BrowserContextOptions = {
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true,
};

export const playwrightConfig = {
  launchOptions,
  contextOptions,
};

export default playwrightConfig;
