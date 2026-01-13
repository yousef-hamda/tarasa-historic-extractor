/**
 * Playwright configuration for Facebook scraping
 *
 * HEADLESS mode is enabled by default to prevent visible browser windows.
 * Set HEADLESS=false in .env only for debugging purposes.
 */

// Check environment - default to headless unless explicitly disabled
const isHeadless = process.env.HEADLESS !== 'false';

export const playwrightConfig = {
  timeout: 180000, // 3 minutes
  headless: isHeadless,
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-gpu', // Helps with stability in headless mode
    '--disable-setuid-sandbox',
    '--disable-software-rasterizer',
  ],
};

export default playwrightConfig;