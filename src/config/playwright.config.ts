export const browserConfig = {
  headless: false,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
  ],
  ignoreHTTPSErrors: true,
  viewport: { width: 1280, height: 720 },
};
