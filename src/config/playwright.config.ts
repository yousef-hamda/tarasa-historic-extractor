export const playwrightConfig = {
  timeout: 180000, // Increased to 3 minutes
  headless: false,
  viewport: { width: 1280, height: 720 },
  ignoreHTTPSErrors: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
  ],
};

export default playwrightConfig;